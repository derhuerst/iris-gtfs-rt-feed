import {ok} from 'node:assert/strict'
import {createLogger} from './logger.js'
import {subscribeToRedisStream} from './redis.js'
import {isProgrammerError} from './util.js'
import {decompress as decompressZstd} from '@mongodb-js/zstd'

const logger = createLogger('iris', {
	level: (process.env.LOG_LEVEL_IRIS || 'warn').toLowerCase(),
})

// In the `message_queue_change` Redis stream, we implictly assume the following order of fields:
// 0. hash_id
// 1. service_date
// 2. stop_id
// 3. plan_compressed
// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/a535fbf71da775844bedde3332de35b78618bb40/database/realtime_stream_unparsed_data.md#message_queue_plan
const FIELDS_IDX_PLAN_COMPRESSED = 3 * 2

const subscribeToIrisPlans = async function* (cfg, opt = {}) {
	const {
		redis,
	} = cfg
	ok(redis, 'redis must be passed in')

	const irisPlanMsgs = subscribeToRedisStream(redis, 'message_queue_plan', {
		binary: true,
		// todo: persist cursor, pass in persisted value as `start`
		...opt,
	})
	for await (const [msgIdRaw, fields] of irisPlanMsgs) {
		const msgId = msgIdRaw.toString('utf8')
		try {
			const planCompressed = fields[FIELDS_IDX_PLAN_COMPRESSED + 1]
			// We assume that `plan_compressed` is zstandard-compressed JSON.
			const irisPlan = JSON.parse((await decompressZstd(planCompressed)).toString('utf8'))
			logger.trace({
				messageId: msgId,
				irisPlan,
			}, 'processing IRIS plan')

			yield [irisPlan, msgId]
		} catch (err) {
			logger.error({
				error: err,
				messageId: msgId,
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
const FIELDS_IDX_CHANGE_COMPRESSED = 5 * 2

const subscribeToIrisChanges = async function* (cfg, opt = {}) {
	const {
		redis,
	} = cfg
	ok(redis, 'redis must be passed in')

	const irisChangeMsgs = subscribeToRedisStream(redis, 'message_queue_change', {
		binary: true,
		// todo: persist cursor, pass in persisted value as `start`
		...opt,
	})
	for await (const [msgIdRaw, fields] of irisChangeMsgs) {
		const msgId = msgIdRaw.toString('utf8')
		try {
			const changeCompressed = fields[FIELDS_IDX_CHANGE_COMPRESSED + 1]
			// We assume that `change_compressed` is zstandard-compressed JSON.
			const irisChange = JSON.parse((await decompressZstd(changeCompressed)).toString('utf8'))
			logger.trace({
				messageId: msgId,
				irisChange,
			}, 'processing IRIS change')

			yield [irisChange, msgId]
		} catch (err) {
			logger.error({
				error: err,
				messageId: msgId,
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
