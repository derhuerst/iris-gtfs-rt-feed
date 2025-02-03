import {
	ok,
	deepStrictEqual,
} from 'node:assert/strict'
import {DateTime} from 'luxon'
import {performance} from 'node:perf_hooks'
import {
	connectToPostgres,
	escapeForLikeOp,
} from './db.js'
import {stationsByEvaNr} from './stations.js'
import {
	parseIrisTimetableStopId,
} from './iris.js'

const _buildFindScheduleStopTimeQuery = (cfg) => {
	const {
		serviceDate,
		possibleRouteNames,
		tripStart,
		stopSequenceInclSvcStops,
		departure,
		stopId,
		normalizedStopName,
		normalizedPrevStopName,
		normalizedNextStopName,
	} = cfg

	let query = ''
	let params = []
	let paramsI = 1

	query += `\
SELECT
	route_id,
	route_short_name,
	trip_id,
	trip_start,
	stop_sequence_consec,
	t_arrival,
	t_departure,
	stop_id
FROM (
	SELECT
		*,
		first_value(t_departure) OVER (PARTITION BY trip_id, "date" ORDER BY stop_sequence_consec) AS trip_start,
		lag(stop_name, 1) OVER (PARTITION BY trip_id, "date" ORDER BY stop_sequence_consec) AS prev_stop_name,
		lead(stop_name, 1) OVER (PARTITION BY trip_id, "date" ORDER BY stop_sequence_consec) AS next_stop_name
	FROM arrivals_departures
	WHERE date = $${paramsI++}
	-- todo: compare normalized route/line names?
	AND route_short_name = ANY($${paramsI++})
) t
WHERE True
AND t_departure >= $${paramsI++} AND t_departure <= $${paramsI++}
`
	params.push(
		serviceDate,
		possibleRouteNames,
		DateTime.fromISO(departure).minus({minutes: 1}).toISO(),
		DateTime.fromISO(departure).plus({minutes: 1}).toISO(),
	)

	query += `\
AND (
`
	let _or = false

	// match by stop_sequence_consec & stop_id
	if (stopSequenceInclSvcStops !== null && stopId !== null) {
		query += `\
${_or ? 'OR ' : ''}(
	stop_sequence_consec = $${paramsI++}
	AND stop_id = $${paramsI++}
)
`
		params.push(
			stopSequenceInclSvcStops,
			stopId,
		)
		_or = true
	}

	// match by stop_sequence_consec & stop_name
	if (stopSequenceInclSvcStops !== null && normalizedStopName !== null) {
		query += `\
${_or ? 'OR ' : ''}(
	stop_sequence_consec = $${paramsI++}
	AND stop_name ILIKE $${paramsI++}
)
`
		params.push(
			stopSequenceInclSvcStops,
			'%' + escapeForLikeOp(normalizedStopName) + '%',
		)
		_or = true
	}

	// match by prev_stop_name, stop_name & next_stop_name
	if (normalizedPrevStopName !== null && normalizedStopName !== null && normalizedNextStopName) {
		query += `\
${_or ? 'OR ' : ''}(
	prev_stop_name ILIKE $${paramsI++}
	AND stop_name ILIKE $${paramsI++}
	AND next_stop_name ILIKE $${paramsI++}
)
`
		params.push(
			'%' + escapeForLikeOp(normalizedPrevStopName) + '%',
			'%' + escapeForLikeOp(normalizedStopName) + '%',
			'%' + escapeForLikeOp(normalizedNextStopName) + '%',
		)
		_or = true
	}

	// match by trip_start
	if (tripStart !== null) {
		query += `\
${_or ? 'OR ' : ''}(
	trip_start >= $${paramsI++}
	AND trip_start <= $${paramsI++}
)
`
		params.push(
			DateTime.fromISO(tripStart).minus({minutes: 1}).toISO(),
			DateTime.fromISO(tripStart).plus({minutes: 1}).toISO(),
		)
		_or = true
	}

	query += `\
)
-- With >1 result, our match is ambiguous, so we only need 2.
LIMIT 2
`

	return {
		query,
		params,
	}
}

deepStrictEqual(
	_buildFindScheduleStopTimeQuery({
		serviceDate: '2025-01-28',
		possibleRouteNames: ['RB15'],
		tripStart: '2025-01-28T14:47:00+01:00',
		stopSequenceInclSvcStops: 13,
		departure: '2025-01-28T16:01:00+01:00',
		stopId: '8000078',
		normalizedStopName: 'donauwörth',
		normalizedPrevStopName: 'tapf%heim',
		normalizedNextStopName: 'gender%%kingen',
	}),
	{
		query: `\
SELECT
	route_id,
	route_short_name,
	trip_id,
	trip_start,
	stop_sequence_consec,
	t_arrival,
	t_departure,
	stop_id
FROM (
	SELECT
		*,
		first_value(t_departure) OVER (PARTITION BY trip_id, "date" ORDER BY stop_sequence_consec) AS trip_start,
		lag(stop_name, 1) OVER (PARTITION BY trip_id, "date" ORDER BY stop_sequence_consec) AS prev_stop_name,
		lead(stop_name, 1) OVER (PARTITION BY trip_id, "date" ORDER BY stop_sequence_consec) AS next_stop_name
	FROM arrivals_departures
	WHERE date = $1
	-- todo: compare normalized route/line names?
	AND route_short_name = ANY($2)
) t
WHERE True
AND t_departure >= $3 AND t_departure <= $4
AND (
(
	stop_sequence_consec = $5
	AND stop_id = $6
)
OR (
	stop_sequence_consec = $7
	AND stop_name ILIKE $8
)
OR (
	prev_stop_name ILIKE $9
	AND stop_name ILIKE $10
	AND next_stop_name ILIKE $11
)
OR (
	trip_start >= $12
	AND trip_start <= $13
)
)
-- With >1 result, our match is ambiguous, so we only need 2.
LIMIT 2
`,
		params: [
			'2025-01-28',
			['RB15'],
			'2025-01-28T16:00:00.000+01:00',
			'2025-01-28T16:02:00.000+01:00',
			13,
			'8000078',
			13,
			'%donauwörth%',
			'%tapf\\%heim%',
			'%donauwörth%',
			'%gender\\%\\%kingen%',
			'2025-01-28T14:46:00.000+01:00',
			'2025-01-28T14:48:00.000+01:00',
		],
	},
)

// todo: built a proper normalization fn, e.g. using juliuste/db-clean-station-name
// todo: normalize stop_names in the DB
const normalizeStopName = (stopName) => {
	return stopName.toLowerCase().trim()
}

const createMatchIrisPlan = async (cfg, opt = {}) => {
	const {
		logger,
	} = cfg
	const {
		pgOpts,
	} = {
		pgOpts: {},
		...opt,
	}

	const pg = await connectToPostgres(pgOpts)

	const matchIrisPlanWithScheduleStopTimes = async (cfg) => {
		const {
			serviceDate,
			stopId,
			irisPlan,
		} = cfg
		ok(serviceDate, 'cfg.serviceDate is missing/empty')
		ok(stopId, 'cfg.stopId is missing/empty')
		ok(irisPlan, 'cfg.irisPlan is missing/empty')

		// We assume that IRIS always uses EVA numbers.
		const stop = stationsByEvaNr.get(stopId) ?? null
		const normalizedStopName = stop?.name ? normalizeStopName(stop?.name) : null

		// If the lineName is just `44` and tripCategory is `RB`, also look for `RB44` & `RB 44`.
		// todo: if tripCategory is missing, split lineName `RB44` into `RB 44`, too
		const lineName = (irisPlan.arrival || irisPlan.departure)?.line ?? null
		const tripCategory = irisPlan.trip_label?.category ?? null
		const possibleRouteNames = [
			lineName,
		]
		if (tripCategory && lineName && lineName.slice(0, tripCategory.length) !== tripCategory) {
			possibleRouteNames.push(
				tripCategory + lineName, // e.g. `RB44`
				tripCategory + ' ' + lineName, // e.g. `RB 44`
			)
		}

		const {
			routeId,
			tripStart,
			stopSequenceInclSvcStops,
		} = parseIrisTimetableStopId(irisPlan.raw_id ?? '')

		const departure = irisPlan.departure?.planned_time ?? null
		ok(departure, 'irisPlan.departure.planned_time must be present')

		const arrPlannedPath = irisPlan.arrival?.planned_path ?? null
		const prevStopName = arrPlannedPath ? arrPlannedPath[arrPlannedPath.length - 1] : null
		const normalizedPrevStopName = prevStopName && normalizeStopName(prevStopName)

		const depPlannedPath = irisPlan.departure?.planned_path ?? null
		const nextStopName = depPlannedPath ? depPlannedPath[0] : null
		const normalizedNextStopName = nextStopName && normalizeStopName(nextStopName)

		const logCtx = {
			serviceDate,
			possibleRouteNames,
			routeId,
			tripStart,
			stopSequenceInclSvcStops,
			departure,
			stopId,
		}

		logger.trace({
			...logCtx,
		}, 'trying to match IRIS plan')

		let matchedStopTime = null
		let isMatched = false
		{
			{
				const t0 = performance.now()
				const {
					query,
					params,
				} = _buildFindScheduleStopTimeQuery({
					serviceDate,
					possibleRouteNames,
					tripStart,
					stopSequenceInclSvcStops,
					departure,
					stopId,
					normalizedStopName,
					normalizedPrevStopName,
					normalizedNextStopName,
				})
				// todo: add debug hook to log the raw query & params?

				// query DB
				// todo: expose pool wait time vs query execution time as metrics?
				// see also https://github.com/brianc/node-postgres/issues/3111
				const {
					rows,
				} = await pg.query({
					text: query,
					values: params,
				})
				const dbQueryTime = performance.now() - t0
				logCtx.dbQueryTime = +dbQueryTime.toFixed(2)

				if (rows.length > 1) {
					logger.warn({
						...logCtx,
						matchedStopTime,
					}, '>1 GTFS Schedule stop_time, ignoring ambiguous match')
				} else if (rows.length === 1) {
					matchedStopTime = rows[0]
					isMatched = true
					logger.trace({
						...logCtx,
					}, 'found matching GTFS Schedule stop_time')
				} else {
					logger.warn({
						...logCtx,
					}, 'no matching GTFS Schedule stop_time found')
				}
			}
		}

		return {
			matchedStopTime,
			isMatched,
		}
	}

	const stop = async () => {
		await pg.end()
	}

	return {
		matchIrisPlanWithScheduleStopTimes,
		stop,
	}
}

export {
	createMatchIrisPlan,
}
