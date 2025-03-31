import {
	ok,
	deepStrictEqual,
	fail,
	strictEqual,
} from 'node:assert/strict'
import {DateTime} from 'luxon'
import {createLogger} from './logger.js'
import {subscribeToRedisStream} from './redis.js'
import {
	dbTimezone,
	isProgrammerError,
} from './util.js'
import {decompress as decompressZstd} from '@mongodb-js/zstd'
import {MAJOR_VERSION} from './major-version.js'

const REDIS_KEY_PREFIX = MAJOR_VERSION + ':iris:'

const REDIS_CURSORS_PREFIX = `${REDIS_KEY_PREFIX}cur:`

const REDIS_PLANS_PREFIX = `${REDIS_KEY_PREFIX}plans:`
const REDIS_CHANGES_PREFIX = `${REDIS_KEY_PREFIX}changes:`

const logger = createLogger('iris', {
	level: (process.env.LOG_LEVEL_IRIS || 'warn').toLowerCase(),
})

const cursorPersistence = (redis, key) => {
	ok(redis, 'redis must be passed in')
	ok(key, 'key must be passed in')

	const readCursor = async () => {
		return await redis.get(REDIS_CURSORS_PREFIX + key)
	}
	const writeCursor = async (cursor) => {
		await redis.set(REDIS_CURSORS_PREFIX + key, cursor)
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

// We assume the format to be `yyMMddHHmm` (see https://moment.github.io/luxon/#/parsing?id=table-of-tokens).
// We also assume all data to be in Europe/Berlin timezone.
// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/91cd43eafbb465055fae083863d891170351bbf3/api/iris.py#L462
const parseIrisDateTimeStr = (irisDateTimeStr) => {
	return DateTime
		.fromFormat(irisDateTimeStr, 'yyMMddHHmm', {zone: dbTimezone})
		.toISO({suppressMilliseconds: true})
}
const formatIrisDateTimeStr = (iso8601DateTimeStr) => {
	return DateTime
		.fromISO(iso8601DateTimeStr)
		.setZone(dbTimezone)
		.toFormat('yyMMddHHmm')
}

// We assume the ID to be in the `$tripId-$firstDepDate$firstDepTime-$stopSequenceInclServiceStops` format.
// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/91cd43eafbb465055fae083863d891170351bbf3/api/iris.py#L462
const parseIrisTimetableStopId = (timetableStopId) => {
	const res = /^([^-]{3,100})-(\d{10})-(\d{1,3})$/.exec(timetableStopId)
	if (res === null) {
		return {
			tripId: null,
			tripStart: null,
			stopSequenceInclSvcStops: null,
		}
	}

	return {
		tripId: res[1],
		// todo: is it the 0th departure, really? IRIS plan `9144496902521920974-2501310030-4` seems to indicate sth else
		tripStart: parseIrisDateTimeStr(res[2]),
		stopSequenceInclSvcStops: parseInt(res[3]),
	}
}
deepStrictEqual(
	parseIrisTimetableStopId('2868854051011682435-2501281447-13'),
	{
		tripId: '2868854051011682435',
		tripStart: '2025-01-28T14:47:00+01:00',
		stopSequenceInclSvcStops: 13,
	},
)

// As with parseItisTimetableStopId(), we assume the ID to be in the `$tripId-$firstDepDate$firstDepTime-$stopSequenceInclServiceStops` format, see above.
const formatPartialIrisTimetableStopId = (cfg) => {
	const {tripId, tripStart, stopSequenceInclSvcStops} = cfg
	ok(tripId !== null, 'tripId must not be null')
	if (stopSequenceInclSvcStops !== null && tripStart === null) {
		fail(`tripStart must not be null if stopSequenceInclSvcStops isn't`)
	}

	const components = [
		tripId,
	]
	if (tripStart !== null) {
		components.push(
			formatIrisDateTimeStr(tripStart),
			stopSequenceInclSvcStops !== null
				? String(stopSequenceInclSvcStops)
				: '',
		)
	} else {
		components.push('')
	}
	return components.join('-')
}
deepStrictEqual(
	formatPartialIrisTimetableStopId({
		tripId: '2868854051011682435',
		tripStart: '2025-01-28T14:47:00+01:00',
		stopSequenceInclSvcStops: 13,
	}),
	'2868854051011682435-2501281447-13',
)
deepStrictEqual(
	formatPartialIrisTimetableStopId({
		tripId: '2868854051011682435',
		tripStart: '2025-01-28T14:47:00+01:00',
		stopSequenceInclSvcStops: null,
	}),
	'2868854051011682435-2501281447-',
)
deepStrictEqual(
	formatPartialIrisTimetableStopId({
		tripId: '2868854051011682435',
		tripStart: null,
		stopSequenceInclSvcStops: null,
	}),
	'2868854051011682435-',
)

// As with parseItisTimetableStopId(), we assume the IDs to be in the `$tripId-$firstDepDate$firstDepTime-$stopSequenceInclServiceStops` format, see above.
const sortIrisTimetableStopIdsByStopSequence = (idA, idB) => {
	// todo: optimize this by not parsing the date?
	const {
		stopSequenceInclSvcStops: seqA,
	} = parseIrisTimetableStopId(idA)
	const {
		stopSequenceInclSvcStops: seqB,
	} = parseIrisTimetableStopId(idB)
	return Number.isInteger(seqA) && Number.isInteger(seqB)
		? seqA - seqB
		: 0
}
deepStrictEqual(
	sortIrisTimetableStopIdsByStopSequence(
		'2868854051011682435-2501281447-2',
		'2868854051011682435-2501281447-13',
	),
	-11,
)
deepStrictEqual(
	sortIrisTimetableStopIdsByStopSequence(
		'2868854051011682435-2501281447-2',
		'2868854051011682435-2501281447-abc',
	),
	0,
)

// todo: use Redis Hashes for this? they might be more ergonomic, e.g. allow reading all TimetableStops of a trip in one command?

// todo: rename `payloadField` to `timetableStopField`?
const createStoreIrisItem = (prefix, payloadField) => {
	const storeIrisItem = async (stateRedis, irisItem) => {
		const {serviceDate} = irisItem
		ok(serviceDate, 'irisItem.serviceDate is missing/empty')
		const rawId = irisItem[payloadField]?.raw_id
		ok(rawId, `irisItem["${payloadField}"].raw_id is missing/empty`)

		const expiresAtUnixMs = DateTime
			.fromISO(serviceDate, {
				zone: 'Europe/Berlin',
			})
			.plus({days: 2}) // todo: is this enough?
			.toMillis()
		// todo: trace-log
		// console.error(prefix + rawId) // todo: remove
		await stateRedis.set(
			prefix + rawId,
			JSON.stringify(irisItem),
			'EXAT', expiresAtUnixMs,
		)
	}
	return storeIrisItem
}
const storeIrisPlan = createStoreIrisItem(REDIS_PLANS_PREFIX, 'irisPlan')
const storeIrisChange = createStoreIrisItem(REDIS_CHANGES_PREFIX, 'irisChange')

const createReadIrisItems = (prefix) => {
	const readIrisItem = async (stateRedis, cfg) => {
		const keyRangePrefix = prefix + formatPartialIrisTimetableStopId(cfg)
		ok(!keyRangePrefix.includes('*'), 'key range must not include a literal *')
		// https://redis.io/docs/latest/commands/scan/
		// Note: We assume that there are no more than 200 IRIS TimetableStops to query!
		const [cursor, _keys] = await stateRedis.scan(
			'0', // initial value
			'MATCH', keyRangePrefix + '*',
			'COUNT', '200',
		)
		strictEqual(cursor, '0', 'SCAN cursor must be 0, more than 200 items in the range')
		const keys = _keys.sort(sortIrisTimetableStopIdsByStopSequence)

		// todo: trace-log
		// console.error({keyRangePrefix, keys}) // todo: remove
		if (keys.length === 0) {
			return []
		}
		const rows = await stateRedis.mget(...keys)
		return rows.map(row => JSON.parse(row))
	}
	return readIrisItem
}
const readIrisPlans = createReadIrisItems(REDIS_PLANS_PREFIX)
const readIrisChanges = createReadIrisItems(REDIS_CHANGES_PREFIX)

export {
	subscribeToIrisPlans,
	subscribeToIrisChanges,
	parseIrisTimetableStopId,
	formatPartialIrisTimetableStopId,
	storeIrisPlan,
	storeIrisChange,
	readIrisPlans,
	readIrisChanges,
}
