// todo: use import assertions once they're supported by Node.js & ESLint
// https://github.com/tc39/proposal-import-assertions
import {createRequire} from 'module'
const require = createRequire(import.meta.url)

import {test, after} from 'node:test'
import {ok, deepStrictEqual} from 'node:assert/strict'
import {createLogger} from '../lib/logger.js'
import {createMatchIrisPlan} from '../lib/match-iris-plan-with-gtfs-schedule.js'

// see also https://web.archive.org/web/20250131170804/https://www.vias-online.de/wp-content/uploads/sites/5/2024/12/RE19-Regelfahrplan-2025.pdf
const IRIS_PLAN_9187255234335594190_2501302250_5 = require('./fixtures/iris-plan-9187255234335594190-2501302250-5.json')
// const IRIS_CHANGE_9187255234335594190_2501302250_5 = require('./fixtures/iris-change-9187255234335594190-2501302250-5.json')

// see also https://web.archive.org/web/20250131174125/https://bahnhofkarlsruhe.de/wp-content/uploads/2024/02/Fahrplan-RB44-Karlsruhe-Acherm-2024.pdf
const IRIS_PLAN_9144496902521920974_2501310030_4 = require('./fixtures/iris-plan-9144496902521920974-2501310030-4.json')
// const IRIS_CHANGE_9144496902521920974_2501310030_4 = require('./fixtures/iris-change-9144496902521920974-2501310030-4.json')

const {
	matchIrisPlanWithScheduleStopTimes,
	stop,
} = await createMatchIrisPlan({
	logger: createLogger('matching-test', {
		level: 'fatal',
	}),
})
after(async () => {
	await stop()
})

test.skip('correctly matches IRIS plan `9187255234335594190-2501302250-5`', async (t) => {
	const {
		matchedStopTime,
		isMatched,
	} = await matchIrisPlanWithScheduleStopTimes(IRIS_PLAN_9187255234335594190_2501302250_5)
	ok(isMatched, 'must be matched')

	// todo
})

test('correctly matches IRIS plan `9144496902521920974-2501310030-4`', async (t) => {
	const {
		matchedStopTime,
		isMatched,
		// isCached,
	} = await matchIrisPlanWithScheduleStopTimes(IRIS_PLAN_9144496902521920974_2501310030_4)
	// ok(!isCached, 'must not be cached')
	ok(isMatched, 'must be matched')

	// todo
	console.error('matchedStopTime', matchedStopTime)
})
