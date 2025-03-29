import {ok} from 'node:assert/strict'
import _gtfsRtBindings from 'gtfs-rt-bindings'
const {TripUpdate} = _gtfsRtBindings
import {
	formatAsStopTimeEvent,
} from './schedule-stoptimes-as-tripupdate.js'
import {
	kNormalizedStopName,
	kIrisStopSequence,
	kStopLatitude,
	kStopLongitude,
} from './util.js'
import {stationsByEvaNr} from './stations.js'

const {ScheduleRelationship} = TripUpdate.StopTimeUpdate

// Note that we omit `p` (SCHEDULED) here because we only know if a StopTimeUpdate is schedule by comparing with GTFS Schedule data.
const scheduleRelationshipsByIrisStatus = new Map([
	['a', ScheduleRelationship.ADDED],
	['c', ScheduleRelationship.SKIPPED],
])

const formatIrisPlansAndChangesAsTripUpdate = (irisPlanItems, irisChangeItems) => {
	ok(irisPlanItems.length > 0, 'irisPlanItems must not be empty')

	const changesByRawId = new Map(
		irisChangeItems
		.map(changeItem => [changeItem.irisChange.raw_id, changeItem])
		.filter(([key, val]) => key ?? false)
	)

	return {
		// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/56ad7fc9ddf038d2c85d3ccc26007bfddf810ecc/api/iris.py#L105-108
		stop_time_update: irisPlanItems.map((planItem) => {
			const {
				stopId: stop_id,
				irisPlan,
			} = planItem
			const {
				raw_id,
				stop_sequence_id: stop_sequence,
			} = irisPlan
			const changeItem = changesByRawId.has(raw_id)
				? changesByRawId.get(raw_id)
				: null
			const irisChange = changeItem ? changeItem.irisChange : null

			// We assume that IRIS always uses EVA numbers.
			// todo: warn log if stop_id is unknown!
			const stop = stationsByEvaNr.get(stop_id) ?? null
			const normalizedStopName = stop?.normalizedName ?? null

			// todo: add tests for this!
			const changed_status = irisChange?.arrival?.changed_status ?? irisChange?.departure?.changed_status ?? null
			// see also https://gitlab.com/bahnvorhersage/bahnvorhersage/-/blob/56ad7fc/api/iris.py#L105-108
			const schedule_relationship = changed_status
				? scheduleRelationshipsByIrisStatus.get(changed_status) ?? null
				: null

			const plannedArr = irisPlan.arrival?.planned_time ?? null
			const changedArr = changeItem?.irisChange.arrival?.changed_time ?? null
			const arrival = formatAsStopTimeEvent(plannedArr, changedArr)

			const plannedDep = irisPlan.departure?.planned_time ?? null
			const changedDep = changeItem?.irisChange.departure?.changed_time ?? null
			const departure = formatAsStopTimeEvent(plannedDep, changedDep)

			// todo: expose irisPlan.message & irisPlan.{arrival,departure}.messages?
			// todo: expose irisPlan.{arrival,departure}.transition?
			// todo: expose irisPlan.{arrival,departure}.wings?
			// todo: expose irisPlan.planned_platform/irisChange/changed_platform via StopTimeUpdate.stop_time_properties.assigned_stop_id, or via an entirely new Stop with .platform_code?

			const stu = {
				schedule_relationship,
				// The ISIS stop_sequence often doesn't match the DELFI GTFS!
				// see also test/fixtures/iris-plan-9187255234335594190-2501302250-*.json
				// stop_sequence,
				stop_id,
				arrival,
				departure,
			}
			Object.defineProperty(stu, kIrisStopSequence, {value: stop_sequence})
			Object.defineProperty(stu, kNormalizedStopName, {value: normalizedStopName})
			Object.defineProperty(stu, kStopLatitude, {value: stop.latitude})
			Object.defineProperty(stu, kStopLongitude, {value: stop.longitude})
			return stu
		}),
	}
}

export {
	formatIrisPlansAndChangesAsTripUpdate,
}
