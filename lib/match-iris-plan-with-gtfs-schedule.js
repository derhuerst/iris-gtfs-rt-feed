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
	readIrisPlans,
	readIrisChanges,
} from './iris.js'
import {
	formatMatchedScheduleStopTimesAsGtfsRtTripUpdate,
} from './schedule-stoptimes-as-tripupdate.js'
import {
	formatIrisPlansAndChangesAsTripUpdate,
} from './iris-plans-changes-as-tripupdate.js'
import {
	mergeScheduleAndIrisTripUpdates,
} from './merge-tripupdates.js'

// This is adapted from OpenDataVBB/gtfs-rt-feed.
// see also https://github.com/OpenDataVBB/gtfs-rt-feed/blob/12fc305312ef9b2e7526deeb63d962bac2542c8a/lib/match-with-schedule-trip.js#L69-L405
// see also https://github.com/derhuerst/match-gtfs-rt-to-gtfs/blob/7c256ec017106d461e712c8b60e235288915c8a7/lib/find-trip.js#L13-L106
// see also https://github.com/NYC-Open-Transit/mta-subway-gtfs-rt-proxy/blob/8709df6aa24b1656dfb827b7f01f8f614a79ff11/lib/query-schedule-stop-times.js#L6-L95
// todo: DRY with other implementations
const _buildFindScheduleStopTimesQuery = (cfg) => {
	const {
		serviceDate,
		possibleRouteNames,
		timetableStops,
	} = cfg
	ok(Array.isArray(timetableStops), 'cfg.timetableStops must be an array')
	ok(timetableStops.length > 0, 'cfg.timetableStops must not be empty')

	let query = `\
WITH
`
	let params = []
	let paramsI = 1

	// compute filters applied to all stopTimes
	let genericFilters = `\
		AND "date" = $${paramsI++}
`
	params.push(serviceDate)
	if (possibleRouteNames.length > 0) {
		genericFilters += `\
		-- todo: compare normalized route/line names?
		AND route_short_name = ANY($${paramsI++})
`
		params.push(possibleRouteNames)
	}

	let firstCte = true
	for (let i = 0; i < timetableStops.length; i++) {
		const alias = 'st_' + i
		const {
			stopSequenceInclSvcStops,
			departure,
			stopId,
			normalizedStopName,
			stopLatitude,
			stopLongitude,
		} = timetableStops[i]

		query += `\
	${firstCte ? '' : ', '}${alias} AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		JOIN stops ON ad.stop_id = stops.stop_id
		WHERE True
${genericFilters}
`

		// filter by t_arrival/t_departure
		{
			const whenMin = DateTime.fromISO(departure).minus({minutes: 1}).toISO()
			const whenMax = DateTime.fromISO(departure).plus({minutes: 1}).toISO()
			query += `\
		AND t_departure >= $${paramsI++}
		AND t_departure <= $${paramsI++}
`
			params.push(whenMin)
			params.push(whenMax)
		}

		query += `\
		AND (
`
		let _or = false

		// filter by stop/station ID
		if (stopId !== null) {
			const stopIdParamsI = paramsI++
			query += `\
			${_or ? 'OR ' : ''}(
				ad.stop_id = $${stopIdParamsI}
				OR station_id = $${stopIdParamsI}
			)
`
			params.push(stopId)
			_or = true
		}

		// alternatively filter by stop_sequence
		if (stopSequenceInclSvcStops !== null) {
			query += `\
			${_or ? 'OR ' : ''}stop_sequence_consec = $${paramsI++}
`
			params.push(stopSequenceInclSvcStops)
			_or = true
		}

		if (normalizedStopName !== null && stopLatitude !== null && stopLongitude !== null) {
			query += `\
			${_or ? 'OR ' : ''}(
				ad.stop_name ILIKE $${paramsI++}
				AND ST_Distance(stop_loc, ST_MakePoint($${paramsI++}, $${paramsI++})::geography) <= 200
			)
`
			params.push(
				'%' + escapeForLikeOp(normalizedStopName) + '%',
				stopLongitude,
				stopLatitude,
			)
			_or = true
		}

		query += `\
		)
	)
`
		firstCte = false
	}

	{
		query += `\
	, matches AS NOT MATERIALIZED (
		SELECT DISTINCT ON (st_0.trip_id, st_0.date)
			st_0.trip_id,
			st_0."date"
		FROM st_0
`
		// Note: We're starting with the 2nd stop_time!
		for (let i = 1; i < timetableStops.length; i++) {
			const alias = 'st_' + i
			const prevAlias = 'st_' + (i - 1)
			query += `\
		INNER JOIN ${alias} ON (
			${alias}.trip_id = ${prevAlias}.trip_id
			AND ${alias}.date = ${prevAlias}.date
			AND ${alias}.stop_sequence_consec > ${prevAlias}.stop_sequence_consec
		)
`
		}
		query += `\
		-- With >1 result, our match is ambiguous, so we only need 2.
		LIMIT 2
`
	}

	query += `\
	)
SELECT
	route_id,
	direction_id,
	ad.trip_id,
	-- todo: use wheelchair_accessible,
	(ad.date::date)::text AS "date",
	-- todo: trip_start_time
	stop_sequence,
	stop_id,
	t_arrival,
	t_departure
	-- todo: use tz
FROM arrivals_departures ad
WHERE True
-- We can't use a mere \`trip_id = ANY(SELECT trip_id FROM matches)\` because, as of v14, PostgreSQL fails to "push down" the join/filtering [2] into \`arrivals_departures\` even though \`matches\` is materialized and known to be small. By forcing PostgreSQL to "collect" the values from \`matches\` using \`array()\` [0][1], we guide it to first collect results and then filter. (The same applies to \`date\`.)
-- This technique *does not* work (i.e. is slow) when using \`IN\` to filter with (trip_id, date) pairs – using two separate \`= ANY()\` filters is not equivalent, after all! –, so we first filter using \`= ANY()\` on trip_id & date for speed, and then additionally filter on the pairs for correctness.
-- todo: in v16, \`(ad.trip_id, ad.date) IN (SELECT trip_id, "date" FROM matches)\` seems slightly faster but still slow?
-- [0] https://stackoverflow.com/a/15007154/1072129
-- [1] https://dba.stackexchange.com/a/189255/289704
-- [2] https://stackoverflow.com/a/66626205/1072129
AND ad.trip_id = ANY(array(SELECT trip_id FROM matches))
AND ad.date = ANY(array(SELECT "date" FROM matches))
AND (ad.trip_id, ad.date) IN (
	SELECT *
	FROM unnest(
		array(SELECT trip_id FROM matches),
		array(SELECT "date" FROM matches)
	) AS t(trip_id, "date")
)
ORDER BY trip_id, "date", stop_sequence_consec
`

	return {
		query,
		params,
	}
}

deepStrictEqual(
	_buildFindScheduleStopTimesQuery({
		serviceDate: '2025-01-28',
		possibleRouteNames: ['RB15'],
		tripStart: '2025-01-28T14:47:00+01:00',
		timetableStops: [{
			stopSequenceInclSvcStops: 13,
			departure: '2025-01-28T16:01:00+01:00',
			stopId: '8000078',
			normalizedStopName: 'donauwörth',
			stopLatitude: 48.714028,
			stopLongitude: 10.771522,
		}, {
			stopSequenceInclSvcStops: null,
			departure: '2025-01-28T16:08:00+01:00',
			stopId: null,
			normalizedStopName: 'gender%%kingen', // this is on purpose to test the escaping
			stopLatitude: 48.695897,
			stopLongitude: 10.885182,
		}],
	}),
	{
		query: `\
WITH
	st_0 AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		JOIN stops ON ad.stop_id = stops.stop_id
		WHERE True
		AND "date" = $1
		-- todo: compare normalized route/line names?
		AND route_short_name = ANY($2)

		AND t_departure >= $3
		AND t_departure <= $4
		AND (
			(
				ad.stop_id = $5
				OR station_id = $5
			)
			OR stop_sequence_consec = $6
			OR (
				ad.stop_name ILIKE $7
				AND ST_Distance(stop_loc, ST_MakePoint($8, $9)::geography) <= 200
			)
		)
	)
	, st_1 AS NOT MATERIALIZED (
		SELECT
			trip_id,
			"date",
			stop_sequence_consec
		FROM arrivals_departures ad
		JOIN stops ON ad.stop_id = stops.stop_id
		WHERE True
		AND "date" = $1
		-- todo: compare normalized route/line names?
		AND route_short_name = ANY($2)

		AND t_departure >= $10
		AND t_departure <= $11
		AND (
			(
				ad.stop_name ILIKE $12
				AND ST_Distance(stop_loc, ST_MakePoint($13, $14)::geography) <= 200
			)
		)
	)
	, matches AS NOT MATERIALIZED (
		SELECT DISTINCT ON (st_0.trip_id, st_0.date)
			st_0.trip_id,
			st_0."date"
		FROM st_0
		INNER JOIN st_1 ON (
			st_1.trip_id = st_0.trip_id
			AND st_1.date = st_0.date
			AND st_1.stop_sequence_consec > st_0.stop_sequence_consec
		)
		-- With >1 result, our match is ambiguous, so we only need 2.
		LIMIT 2
	)
SELECT
	route_id,
	direction_id,
	ad.trip_id,
	-- todo: use wheelchair_accessible,
	(ad.date::date)::text AS "date",
	-- todo: trip_start_time
	stop_sequence,
	stop_id,
	t_arrival,
	t_departure
	-- todo: use tz
FROM arrivals_departures ad
WHERE True
-- We can't use a mere \`trip_id = ANY(SELECT trip_id FROM matches)\` because, as of v14, PostgreSQL fails to "push down" the join/filtering [2] into \`arrivals_departures\` even though \`matches\` is materialized and known to be small. By forcing PostgreSQL to "collect" the values from \`matches\` using \`array()\` [0][1], we guide it to first collect results and then filter. (The same applies to \`date\`.)
-- This technique *does not* work (i.e. is slow) when using \`IN\` to filter with (trip_id, date) pairs – using two separate \`= ANY()\` filters is not equivalent, after all! –, so we first filter using \`= ANY()\` on trip_id & date for speed, and then additionally filter on the pairs for correctness.
-- todo: in v16, \`(ad.trip_id, ad.date) IN (SELECT trip_id, "date" FROM matches)\` seems slightly faster but still slow?
-- [0] https://stackoverflow.com/a/15007154/1072129
-- [1] https://dba.stackexchange.com/a/189255/289704
-- [2] https://stackoverflow.com/a/66626205/1072129
AND ad.trip_id = ANY(array(SELECT trip_id FROM matches))
AND ad.date = ANY(array(SELECT "date" FROM matches))
AND (ad.trip_id, ad.date) IN (
	SELECT *
	FROM unnest(
		array(SELECT trip_id FROM matches),
		array(SELECT "date" FROM matches)
	) AS t(trip_id, "date")
)
ORDER BY trip_id, "date", stop_sequence_consec
`,
		params: [
			'2025-01-28',
			['RB15'],
			'2025-01-28T16:00:00.000+01:00',
			'2025-01-28T16:02:00.000+01:00',
			'8000078',
			13,
			'%donauwörth%',
			10.771522,
			48.714028,
			'2025-01-28T16:07:00.000+01:00',
			'2025-01-28T16:09:00.000+01:00',
			'%gender\\%\\%kingen%',
			10.885182,
			48.695897,
		],
	},
)

// todo: built a proper normalization fn, e.g. using juliuste/db-clean-station-name
// todo: normalize stop_names in the DB
const normalizeStopName = (stopName) => {
	return stopName.toLowerCase().trim()
}

const createMatchIrisItems = async (cfg, opt = {}) => {
	const {
		logger,
		redis,
	} = cfg
	const {
		pgOpts,
	} = {
		pgOpts: {},
		...opt,
	}

	const pg = await connectToPostgres(pgOpts)

	const matchIrisPlansWithScheduleStopTimes = async (cfg) => {
		const {
			irisTripId,
			irisTripStart,
		} = cfg
		ok(irisTripId, 'cfg.irisTripId is missing/empty')
		ok(irisTripStart, 'cfg.rripStart is missing/empty')

		const irisPlanItems = await readIrisPlans(redis, {
			tripId: irisTripId,
			tripStart: irisTripStart,
			stopSequenceInclSvcStops: null, // all
		})

		const {
			serviceDate,
			irisPlan: irisPlan0,
		} = irisPlanItems[0]

		// If the lineName is just `44` and tripCategory is `RB`, also look for `RB44` & `RB 44`.
		// todo: if tripCategory is missing, split lineName `RB44` into `RB 44`, too
		const lineName = (irisPlan0.arrival || irisPlan0.departure)?.line ?? null
		const tripCategory = irisPlan0.trip_label?.category ?? null
		const possibleRouteNames = [
			lineName,
		]
		if (tripCategory && lineName && lineName.slice(0, tripCategory.length) !== tripCategory) {
			possibleRouteNames.push(
				tripCategory + lineName, // e.g. `RB44`
				tripCategory + ' ' + lineName, // e.g. `RB 44`
			)
		}

		const computeStopTimeMatchingParamsFromTimetable = (irisTimetable) => {
			const {stopId, irisPlan} = irisTimetable

			// We assume that IRIS always uses EVA numbers.
			const stop = stationsByEvaNr.get(stopId) ?? null
			const normalizedStopName = stop?.name ? normalizeStopName(stop?.name) : null
			const stopLatitude = stop?.latitude ?? null
			const stopLongitude = stop?.longitude ?? null

			const {
				stop_sequence_id: stopSequenceInclSvcStops,
			} = irisPlan

			// todo: support cases where there is just an arrival
			const departure = irisPlan.departure?.planned_time ?? null
			ok(departure, 'irisPlan.departure.planned_time must be present')

			return {
				stopSequenceInclSvcStops,
				departure,
				stopId,
				normalizedStopName,
				stopLatitude,
				stopLongitude,
			}
		}

		// IRIS sometimes doesn't know about all TimetableStops (stop_times) of a trip.
		// This means that `irisTripStart` & `arrPlannedPath[0]` *do not* always correspond with the 0th stop_time in GTFS schedule.
		// todo: pick the TimetableStops used for matching in a smarter way, e.g. by station weight, ignoring betriebshalte
		// DRY with https://github.com/OpenDataVBB/gtfs-rt-feed/blob/12fc305312ef9b2e7526deeb63d962bac2542c8a/lib/match-with-schedule-trip.js#L454-L472
		const timetableStops = [
			computeStopTimeMatchingParamsFromTimetable(irisPlanItems[0]),
			computeStopTimeMatchingParamsFromTimetable(irisPlanItems[irisPlanItems.length - 1]),
		]

		const logCtx = {
			serviceDate,
			possibleRouteNames,
			irisTripId,
			irisTripStart,
			timetableStops,
		}

		logger.trace({
			...logCtx,
		}, 'trying to match IRIS plan')

		let matchedStopTimes = null
		let isMatched = false
		{
			{
				const t0 = performance.now()
				const {
					query,
					params,
				} = _buildFindScheduleStopTimesQuery({
					serviceDate,
					possibleRouteNames,
					timetableStops,
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

				const row0 = rows[0] ?? null
				const rowN = rows[rows.length - 1] ?? null
				if (rows.length === 0) {
					logger.warn({
						...logCtx,
					}, 'no matching GTFS Schedule stop_time found')
				} else if (row0.trip_id !== rowN.trip_id || row0.date !== rowN.date) {
					logger.warn({
						...logCtx,
						matchedStopTimes,
					}, '>1 GTFS Schedule trip "instance", ignoring ambiguous match')
				} else {
					matchedStopTimes = rows

					logger.debug({
						...logCtx,
						matchedStopTimes,
					}, 'successfully matched GTFS Schedule trip "instance"')
					isMatched = true
				}
			}
		}

		return {
			matchedStopTimes,
			isMatched,
			// only returned so that consuming code doesn't have to read them again
			irisPlanItems,
		}
	}

	const mergeIrisPlansAndChangesWithScheduleStopTimes = async (cfg) => {
		const {
			irisTripId,
			irisTripStart,
		} = cfg
		const logCtx = {
			irisTripId,
			irisTripStart,
		}

		const {
			isMatched,
			matchedStopTimes,
			irisPlanItems,
		} = await matchIrisPlansWithScheduleStopTimes(cfg)
		if (!isMatched) {
			return {
				isMatched,
				tripUpdate: null,
			}
		}

		const scheduleTripUpdate = formatMatchedScheduleStopTimesAsGtfsRtTripUpdate(matchedStopTimes)

		const irisChangeItems = await readIrisChanges(redis, {
			tripId: irisTripId,
			tripStart: irisTripStart,
			stopSequenceInclSvcStops: null, // all
		})
		const irisTripUpdate = formatIrisPlansAndChangesAsTripUpdate(irisPlanItems, irisChangeItems)

		const tripUpdate = mergeScheduleAndIrisTripUpdates(scheduleTripUpdate, irisTripUpdate)
		logger.trace({
			...logCtx,
			scheduleTripUpdate,
			irisTripUpdate,
			tripUpdate,
		}, 'merged GTFS-Schedule-based & IRIS-based TripUpdates')

		return {
			isMatched,
			tripUpdate,
		}
	}

	const stop = async () => {
		await pg.end()
	}

	return {
		matchIrisPlansWithScheduleStopTimes,
		mergeIrisPlansAndChangesWithScheduleStopTimes,
		stop,
	}
}

export {
	createMatchIrisItems,
}
