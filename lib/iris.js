import {ok} from 'node:assert/strict'
import {createLogger} from './logger.js'
import {subscribeToRedisStream} from './redis.js'
import {isProgrammerError} from './util.js'
import {decompress as decompressZstd} from '@mongodb-js/zstd'
import {MAJOR_VERSION} from './major-version.js'

const REDIS_KEY_PREFIX = MAJOR_VERSION + ':iris:'

const logger = createLogger('iris', {
	level: (process.env.LOG_LEVEL_IRIS || 'warn').toLowerCase(),
})

const cursorPersistence = (redis, key) => {
	ok(redis, 'redis must be passed in')
	ok(key, 'key must be passed in')

	const readCursor = async () => {
		return await redis.get(REDIS_KEY_PREFIX + key)
	}
	const writeCursor = async (cursor) => {
		await redis.set(REDIS_KEY_PREFIX + key, cursor)
	}

	return {
		readCursor,
		writeCursor,
	}
}

// In the `message_queue_change` Redis stream, we implictly assume the following order of fields:
// 0. hash_id
// 1. service_date
// 2. stop_id
// 3. plan_compressed
// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/a535fbf71da775844bedde3332de35b78618bb40/database/realtime_stream_unparsed_data.md#message_queue_plan
const FIELDS_IDX_PLAN_SERVICE_DATE = 1 * 2
const FIELDS_IDX_PLAN_STOP_ID = 2 * 2
const FIELDS_IDX_PLAN_COMPRESSED = 3 * 2

const subscribeToIrisPlans = async function* (cfg, opt = {}) {
	const {
		stateRedis,
		irisRedis,
	} = cfg
	ok(stateRedis, 'cfg.stateRedis must be passed in')
	ok(irisRedis, 'cfg.irisRedis must be passed in')

	const {readCursor, writeCursor} = cursorPersistence(stateRedis, 'plans_cursor')
	const irisPlanMsgs = subscribeToRedisStream(irisRedis, 'message_queue_plan', {
		binary: true,
		readCursor,
		writeCursor,
		...opt,
	})
	for await (const [msgIdRaw, fields] of irisPlanMsgs) {
		const msgId = msgIdRaw.toString('utf8')
		try {
			const serviceDate = fields[FIELDS_IDX_PLAN_SERVICE_DATE + 1].toString('utf8')
			// https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/94dd07260d77c81a855d0d1defd2720f04f6c49a/database/unparsed.py#L58
			const stopId = String(fields[FIELDS_IDX_PLAN_STOP_ID + 1].readInt32BE(0))

			const planCompressed = fields[FIELDS_IDX_PLAN_COMPRESSED + 1]
			// We assume that `plan_compressed` is zstandard-compressed JSON.
			const irisPlan = JSON.parse((await decompressZstd(planCompressed)).toString('utf8'))

			const result = {
				redisMessageId: msgId,
				serviceDate,
				stopId,
				irisPlan,
			}
			logger.trace(result, 'fetched IRIS plan')
			yield result
		} catch (err) {
			logger.error({
				error: err,
				redisMessageId: msgId,
				messageFields: fields,
			}, `failed to process a \`message_queue_plan\` message: ${err.message}`)
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}
}

// In the `message_queue_change` Redis stream, we implictly assume the following order of fields:
// 0. service_date
// 1. hash_id
// 2. change_hash
// 3. stop_id
// 4. time_crawled
// 5. change_compressed
// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/a535fbf71da775844bedde3332de35b78618bb40/database/realtime_stream_unparsed_data.md#message_queue_change
const FIELDS_IDX_CHANGE_SERVICE_DATE = 0 * 2
const FIELDS_IDX_CHANGE_STOP_ID = 3 * 2
const FIELDS_IDX_CHANGE_COMPRESSED = 5 * 2

const subscribeToIrisChanges = async function* (cfg, opt = {}) {
	const {
		stateRedis,
		irisRedis,
	} = cfg
	ok(stateRedis, 'cfg.stateRedis must be passed in')
	ok(irisRedis, 'cfg.irisRedis must be passed in')

	const {readCursor, writeCursor} = cursorPersistence(stateRedis, 'changes_cursor')
	const irisChangeMsgs = subscribeToRedisStream(irisRedis, 'message_queue_change', {
		binary: true,
		readCursor,
		writeCursor,
		...opt,
	})
	for await (const [msgIdRaw, fields] of irisChangeMsgs) {
		const msgId = msgIdRaw.toString('utf8')
		try {
			const serviceDate = fields[FIELDS_IDX_CHANGE_SERVICE_DATE + 1].toString('utf8')
			// https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/94dd07260d77c81a855d0d1defd2720f04f6c49a/database/unparsed.py#L29
			const stopId = String(fields[FIELDS_IDX_CHANGE_STOP_ID + 1].readInt32BE(0))

			const changeCompressed = fields[FIELDS_IDX_CHANGE_COMPRESSED + 1]
			// We assume that `change_compressed` is zstandard-compressed JSON.
			const irisChange = JSON.parse((await decompressZstd(changeCompressed)).toString('utf8'))

			const result = {
				redisMessageId: msgId,
				serviceDate,
				stopId,
				irisChange,
			}

			logger.trace(result, 'fetched IRIS change')
			yield result
		} catch (err) {
			logger.error({
				error: err,
				redisMessageId: msgId,
				messageFields: fields,
			}, `failed to process a \`message_queue_change\` message: ${err.message}`)
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}
}

export {
	subscribeToIrisPlans,
	subscribeToIrisChanges,
}
