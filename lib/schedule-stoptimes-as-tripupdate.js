import {ok} from 'node:assert/strict'
import _gtfsRtBindings from 'gtfs-rt-bindings'
const {TripUpdate} = _gtfsRtBindings
import {DateTime} from 'luxon'
import {deepStrictEqual} from 'node:assert'

const {ScheduleRelationship} = TripUpdate.StopTimeUpdate

const formatAsStopTimeEvent = (plannedIso8601Str, changedIso8601Str) => {
	const plannedWhen = plannedIso8601Str
		? DateTime.fromISO(plannedIso8601Str).toSeconds()
		: null
	const changedWhen = changedIso8601Str
		? DateTime.fromISO(changedIso8601Str).toSeconds()
		: null
	return {
		time: changedWhen ?? plannedWhen,
		delay: plannedWhen !== null && changedWhen !== null ? changedWhen - plannedWhen : null,
	}
}
deepStrictEqual(
	formatAsStopTimeEvent('2025-01-30T22:07:00+00:00', '2025-01-30T22:10:00+00:00'),
	{
		time: 1738275000, // 2025-01-30T22:10:00+00:00
		delay: 180,
	},
)

const formatMatchedScheduleStopTimesAsGtfsRtTripUpdate = (matchedStopTimes) => {
	ok(matchedStopTimes.length > 0, 'matchedStopTimes must not be empty')
	const {
		route_id,
		trip_id,
		direction_id,
		date: start_date,
	} = matchedStopTimes[0]
	ok(route_id, 'route_id missing/empty')
	ok(trip_id, 'route_id missing/empty')
	ok(direction_id, 'route_id missing/empty')
	ok(start_date, 'route_id missing/empty')

	return {
		trip: {
			route_id,
			trip_id,
			direction_id,
			schedule_relationship: ScheduleRelationship.SCHEDULED,
		},
		stop_time_update: matchedStopTimes.map((stopTime) => {
			const {
				stop_sequence,
				stop_id,
				t_arrival,
				t_departure,
			} = stopTime

			const arrival = formatAsStopTimeEvent(t_arrival)
			const departure = formatAsStopTimeEvent(t_departure)

			const stu = {
				stop_sequence,
				stop_id, // Düsseldorf Hbf
				arrival,
				departure,
				// todo: expose changed_platform via `stop_time_properties.assigned_stop_id`?
			}
			return stu
		}),
	}
}

export {
	formatAsStopTimeEvent,
	formatMatchedScheduleStopTimesAsGtfsRtTripUpdate,
}
