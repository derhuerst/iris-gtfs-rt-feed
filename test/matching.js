// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

import {test, after, beforeEach} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import {connectToRedis} from '../lib/redis.js'
import {createLogger} from '../lib/logger.js'
import {createMatchIrisItems} from '../lib/match-iris-plan-with-gtfs-schedule.js'
import {
	parseIrisTimetableStopId,
	storeIrisPlan,
} from '../lib/iris.js'

// see also https://web.archive.org/web/20250131170804/https://www.vias-online.de/wp-content/uploads/sites/5/2024/12/RE19-Regelfahrplan-2025.pdf
const IRIS_PLAN_9187255234335594190_2501302250_1 = require('./fixtures/iris-plan-9187255234335594190-2501302250-1.json')
const IRIS_PLAN_9187255234335594190_2501302250_5 = require('./fixtures/iris-plan-9187255234335594190-2501302250-5.json')
const IRIS_PLAN_9187255234335594190_2501302250_15 = require('./fixtures/iris-plan-9187255234335594190-2501302250-15.json')

// see also https://web.archive.org/web/20250131172454/https://www.agilis.de/wp-content/uploads/2023/05/RB15_Ingolstadt-Ulm.pdf
const IRIS_PLAN_2868854051011682435_2501281447_13_raw = require('./fixtures/iris-plan-2868854051011682435-2501281447-13.raw.json')

// see also https://web.archive.org/web/20250131174125/https://bahnhofkarlsruhe.de/wp-content/uploads/2024/02/Fahrplan-RB44-Karlsruhe-Acherm-2024.pdf
const IRIS_PLAN_9144496902521920974_2501310030_4 = require('./fixtures/iris-plan-9144496902521920974-2501310030-4.json')
// const IRIS_CHANGE_9144496902521920974_2501310030_4 = require('./fixtures/iris-change-9144496902521920974-2501310030-4.json')

const redis = await connectToRedis()
const {
	matchIrisPlansAndChangesWithScheduleStopTimes,
	stop,
} = await createMatchIrisItems({
	logger: createLogger('matching-test', {
		level: 'fatal',
	}),
	redis,
})
after(async () => {
	await stop()
})

beforeEach(async () => {
	await redis.flushdb()
})

test.skip('correctly matches IRIS plan `2868854051011682435-2501281447-13`', async (t) => {
	// todo: store in Redis

	const {
		matchedStopTimes,
		isMatched,
	} = await matchIrisPlansAndChangesWithScheduleStopTimes(IRIS_PLAN_2868854051011682435_2501281447_13_raw)
	ok(isMatched, 'must be matched')

	// todo
})

test('correctly matches IRIS plan `9187255234335594190-2501302250-5`', async (t) => {
	const {irisPlan: irisPlan1} = IRIS_PLAN_9187255234335594190_2501302250_1
	const {
		tripId,
		tripStart,
	} = parseIrisTimetableStopId(irisPlan1.raw_id)

	await Promise.all([
		storeIrisPlan(redis, IRIS_PLAN_9187255234335594190_2501302250_1),
		storeIrisPlan(redis, IRIS_PLAN_9187255234335594190_2501302250_5),
		storeIrisPlan(redis, IRIS_PLAN_9187255234335594190_2501302250_15),
	])

	const {
		matchedStopTimes,
		isMatched,
	} = await matchIrisPlansAndChangesWithScheduleStopTimes({
		tripId,
		tripStart,
	})
	ok(isMatched, 'must be matched')

	// todo
})

test.skip('correctly matches IRIS plan `9144496902521920974-2501310030-4`', async (t) => {
	// todo: store in Redis

	const {
		matchedStopTimes,
		isMatched,
		// isCached,
	} = await matchIrisPlansAndChangesWithScheduleStopTimes(IRIS_PLAN_9144496902521920974_2501310030_4)
	// ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	// todo
})

// todo: add tests for pickStopTimeUpdatesForMatching()?
