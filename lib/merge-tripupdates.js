import mergeWith from 'lodash/mergeWith.js'
import {
	fail,
	deepStrictEqual,
} from 'node:assert/strict'
import {distance as turfDistance} from '@turf/distance'
import {point} from '@turf/helpers'
import {stationsByEvaNr} from './stations.js'
import {
	kNormalizedStopName,
	kStopLatitude,
	kStopLongitude,
} from './util.js'

const TIME_MATCHING_MAX_DEVIATION = 60 // seconds

// todo: DRY this with
// - https://github.com/OpenDataVBB/gtfs-rt-feed/blob/12fc305312ef9b2e7526deeb63d962bac2542c8a/lib/merge-tripupdates.js
// - https://github.com/NYC-Open-Transit/mta-subway-gtfs-rt-proxy/blob/8709df6aa24b1656dfb827b7f01f8f614a79ff11/lib/match-trip-update.js#L175-L223

// Merges objects deeply, but only lets entries of later objects overwrite those of former ones if the later ones are not null/undefined.
const mergeButIgnoreNull = (...objs) => {
	return mergeWith(
		{},
		...objs,
		(formerVal, laterVal) => {
			return laterVal ?? formerVal
		},
	)
}
deepStrictEqual(
	mergeButIgnoreNull({
		foo: 1,
		bar: 2,
		baz: {_: null},
	}, {
		foo: null,
		bar: 3,
		baz: {_: 4},
	}),
	{
		foo: 1,
		bar: 3,
		baz: {_: 4},
	},
)

const scheduledTime = (stopTimeEvent) => {
	return Number.isInteger(stopTimeEvent?.time)
		? stopTimeEvent.time - (stopTimeEvent.delay ?? 0)
		: null
}

// todo: DRY this with other matching implementations
// - the SQL implementation in `_buildFindScheduleStopTimesQuery()`, they essentially (must!) do the same
// - https://github.com/OpenDataVBB/gtfs-rt-feed/blob/12fc305312ef9b2e7526deeb63d962bac2542c8a/lib/merge-tripupdates.js#L48-L63
// - https://github.com/NYC-Open-Transit/mta-subway-gtfs-rt-proxy/blob/main/lib/match-trip-update.js#L190-L213
// - https://github.com/derhuerst/find-hafas-data-in-another-hafas/blob/ad351b81dcaad74a2f2cfd0b212aa61b9ccea653/match-stopover.js#L12-L25
// - https://github.com/derhuerst/stable-public-transport-ids/blob/ee0bc3d3f1dc3a6600ff7db03ab5668c5320b2a9/arrival-departure.js#L22-L60
// - MOTIS & OTP
const stopTimeUpdatesAreEquivalent = (sTU1, opt = {}) => (sTU2) => {
	const {
		stopIdsAreEqual,
		stopTimeEventsAreEqual,
	} = {
		stopIdsAreEqual: (stopA, stopB) => stopA.stop_id === stopB.stop_id,
		stopTimeEventsAreEqual: (sTEA, sTEB) => scheduledTime(sTEA) === scheduledTime(sTEB),
		...opt,
	}

	const equalStopIds = sTU1.stop_id !== null && stopIdsAreEqual(sTU1, sTU2)
	const equalSchedArr = scheduledTime(sTU1.arrival) !== null && stopTimeEventsAreEqual(sTU1.arrival, sTU2.arrival)
	const equalSchedDep = scheduledTime(sTU1.departure) !== null && stopTimeEventsAreEqual(sTU1.departure, sTU2.departure)
	const locationsAreVeryClose = (
		(kStopLongitude in sTU1) &&
		(kStopLatitude in sTU1) &&
		(kStopLongitude in sTU2) &&
		(kStopLatitude in sTU2) &&
		turfDistance(
			point([sTU1[kStopLongitude], sTU1[kStopLatitude]]),
			point([sTU2[kStopLongitude], sTU2[kStopLatitude]]),
		) < .1
	)

	// Note: In contrast to other implementations, with the DELFI GTFS Schedule data and IRIS realtime data, we cannot assume that the stop_sequences "match".
	return (equalStopIds || locationsAreVeryClose) && (equalSchedArr || equalSchedDep)
}

const mergeStopTimeEvents = (schedSTE, rtSTE) => {
	// todo: merge fields instead of preferring entire objects!
	const sTE = rtSTE ?? schedSTE ?? null
	return sTE
}
const mergeStopTimeUpdates = (schedSTU, rtSTU) => {
	const sTU = {
		...mergeButIgnoreNull(schedSTU, rtSTU),
		// always prefer schedule stop_id
		stop_id: schedSTU.stop_id ?? rtSTU.stop_id ?? null,
		arrival: mergeStopTimeEvents(schedSTU.arrival, rtSTU.arrival),
		departure: mergeStopTimeEvents(schedSTU.departure, rtSTU.departure),
	}
	// todo: deep-merge .stop_time_properties if present
	return sTU
}
deepStrictEqual(
	mergeStopTimeUpdates({
		stop_sequence: 12,
		stop_id: 'some-schedule-id',
		arrival: null,
		departure: {time: 2345, delay: null},
	}, {
		stop_id: 'some-realtime-id',
		arrival: {time: 1234, delay: 0},
		departure: {time: 2344, delay: -1},
	}),
	{
		stop_sequence: 12,
		stop_id: 'some-schedule-id',
		arrival: {time: 1234, delay: 0},
		departure: {time: 2344, delay: -1},
	},
)

const combineStopTimeUpdates = (schedSTUs, rtSTUs, opt = {}) => {
	const stopIdsAreEqual = (schedSTU, irisSTU) => {
		if (schedSTU.stop_id === irisSTU.stop_id) {
			return true
		}

		// We assume that IRIS always uses EVA numbers.
		const _irisStation = stationsByEvaNr.get(irisSTU.stop_id) ?? null
		if (!_irisStation) {
			// todo: warn-log?
			return false
		}

		const schedNormalizedStopName = schedSTU[kNormalizedStopName]
		const irisNormalizedStopName = _irisStation.normalizedName ?? null
		return schedNormalizedStopName === irisNormalizedStopName
	}

	opt = {
		stopIdsAreEqual,
		...opt,
	}

	const merged = []
	let rtSTUsI = 0, schedSTUsI = 0
	while (true) {
		// There are no more realtime/schedule STUs (respectively), so we just pick all others.
		if (rtSTUsI >= rtSTUs.length) {
			const remainingSchedSTUs = schedSTUs.slice(schedSTUsI)
			merged.push(...remainingSchedSTUs)
			schedSTUsI += remainingSchedSTUs.length
			break
		}
		if (schedSTUsI >= schedSTUs.length) {
			const remainingRtSTUs = rtSTUs.slice(rtSTUsI)
			merged.push(...remainingRtSTUs)
			rtSTUsI += remainingRtSTUs.length
			break
		}

		const rtSTU = rtSTUs[rtSTUsI]
		const schedSTU = schedSTUs[schedSTUsI]
		if (!rtSTU && !schedSTU) {
			break // done!
		}
		if (stopTimeUpdatesAreEquivalent(schedSTU, opt)(rtSTU)) {
			merged.push(mergeStopTimeUpdates(schedSTU, rtSTU))
			schedSTUsI++
			rtSTUsI++
			continue
		}
 
		const iMatchingSchedSTU = schedSTUs.slice(schedSTUsI).findIndex(stopTimeUpdatesAreEquivalent(rtSTU, opt))
		const iMatchingRtSTU = rtSTUs.slice(rtSTUsI).findIndex(stopTimeUpdatesAreEquivalent(schedSTU, opt))

		if (iMatchingRtSTU > 0) {
			// There's a realtime STU matching the current schedule STU, but it is some items after the current (realtime) one. So we take the unmatched schedule STU first.
			merged.push(rtSTU)
			rtSTUsI++
			continue
		}
		if (iMatchingSchedSTU > 0) {
			// There's a schedule STU matching the current realtime STU, but it is some items after the current (schedule) one. So we take the unmatched realtime STU first.
			merged.push(schedSTU)
			schedSTUsI++
			continue
		}

		if (iMatchingRtSTU < 0 && iMatchingSchedSTU < 0) {
			if (Number.isInteger(rtSTU.stop_sequence) && Number.isInteger(schedSTU.stop_sequence)) {
				if (rtSTU.stop_sequence < schedSTU.stop_sequence) {
					merged.push(rtSTU)
					rtSTUsI++
				} else {
					merged.push(schedSTU)
					schedSTUsI++
				}
				continue
			}
			if (Number.isInteger(rtSTU.arrival?.time) && Number.isInteger(schedSTU.arrival?.time)) {
				if (rtSTU.arrival.time < schedSTU.arrival.time) {
					merged.push(rtSTU)
					rtSTUsI++
				} else {
					merged.push(schedSTU)
					schedSTUsI++
				}
				continue
			}
			if (Number.isInteger(rtSTU.departure?.time) && Number.isInteger(schedSTU.departure?.time)) {
				if (rtSTU.departure.time < schedSTU.departure.time) {
					merged.push(rtSTU)
					rtSTUsI++
				} else {
					merged.push(schedSTU)
					schedSTUsI++
				}
				continue
			}
		}

		if (iMatchingRtSTU < 0) {
			// The current schedule STU has no matching (realtime) STU, so we take it as-is.
			merged.push(schedSTU)
			schedSTUsI++
			continue
		}
		if (iMatchingSchedSTU < 0) {
			// The current realtime STU has no matching (schedule) STU, so we take it as-is.
			merged.push(rtSTU)
			rtSTUsI++
			continue
		}
		fail('unexpected state')
		break
	}

	// todo: fix stop_sequences?
	return merged
}

deepStrictEqual(
	combineStopTimeUpdates(
		[ // schedSTUs
			// A missing
			{
				stop_sequence: 2,
				stop_id: 'B',
				arrival: {time: 2000},
				departure: {time: 3000},
			},
			// C missing
			{
				stop_sequence: 4, // gap of 1, on purpose
				stop_id: 'D ', // note the space
				arrival: {time: 6000},
				departure: {time: 7000},
			},
			{
				stop_sequence: 5,
				stop_id: 'E',
				// 0s dwelling, on purpose
				arrival: {time: 8000},
				departure: {time: 8000},
			},
			// F missing
			// G missing
		],
		[ // rtSTUs
			{
				stop_id: 'A',
				departure: {time: 1000},
			},
			{
				stop_id: 'B',
				arrival: {time: 2100, delay: 100},
				departure: {time: 3050, delay: 50},
			},
			{
				stop_id: 'C',
				arrival: {time: 4000},
				departure: {time: 5010, delay: 10},
			},
			{
				stop_id: ' D', // note the space
				arrival: {time: 6000, delay: 0},
				departure: {time: 7020, delay: 20},
			},
			// E missing
			{
				stop_id: 'F',
				arrival: {time: 8980, delay: -20},
				departure: {time: 10010, delay: 10},
			},
			{
				stop_id: 'G',
				arrival: {time: 10080, delay: -20},
			},
		],
		{
			stopIdsAreEqual: (stuA, stuB) => stuA.stop_id.trim() === stuB.stop_id.trim(),
		},
	),
	[
		{
			stop_id: 'A',
			departure: {time: 1000},
		},
		{
			stop_sequence: 2,
			stop_id: 'B',
			arrival: {time: 2100, delay: 100},
			departure: {time: 3050, delay: 50},
		},
		{
			stop_id: 'C',
			arrival: {time: 4000},
			departure: {time: 5010, delay: 10},
		},
		{
			stop_sequence: 4,
			stop_id: 'D ', // note the space
			arrival: {time: 6000, delay: 0},
			departure: {time: 7020, delay: 20},
		},
		{
			stop_sequence: 5,
			stop_id: 'E',
			arrival: {time: 8000},
			departure: {time: 8000},
		},
		{
			stop_id: 'F',
			arrival: {time: 8980, delay: -20},
			departure: {time: 10010, delay: 10},
		},
		{
			stop_id: 'G',
			arrival: {time: 10080, delay: -20},
		},
	],
)

const mergeScheduleAndIrisTripUpdates = (schedTU, rtTU, opt = {}) => {
	const {
		timeAllowFuzzyMatching,
	} = {
		timeAllowFuzzyMatching: false,
		...opt,
	}

	if (timeAllowFuzzyMatching) {
		opt = {
			...opt,
			stopTimeEventsAreEqual: (sTEA, sTEB) => {
				const diff = scheduledTime(sTEA) - scheduledTime(sTEB) // seconds
				return Number.isFinite(diff) ? Math.abs(diff) <= TIME_MATCHING_MAX_DEVIATION : false
			}
		}
	}

	const tU = mergeButIgnoreNull(schedTU, rtTU)
	tU.stop_time_update = combineStopTimeUpdates(
		schedTU.stop_time_update,
		rtTU.stop_time_update,
		opt,
	)
	// todo: .timestamp
	// todo: update .delay?
	return tU
}

export {
	mergeScheduleAndIrisTripUpdates,
}
