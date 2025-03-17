import fs from 'node:fs'
import {createLogger} from './logger.js'
import throttle from 'lodash/throttle.js'
import {DateTime} from 'luxon'
import {gtfsRtDifferentialToFullDataset} from 'gtfs-rt-differential-to-full-dataset'

import {MAJOR_VERSION} from './major-version.js'

const logger = createLogger('gtfsrt')

const redisKey = (keyType, id) => {
	return MAJOR_VERSION + ':' + keyType + ':' + id;
}

const differentialToFull = gtfsRtDifferentialToFullDataset({
	ttl: 5 * 60 * 1000, // 2 minutes
})

const t0 = Date.now()
const processTripUpdate = (tripUpdate) => {
	const feedEntity = {
		id: String(t0 + performance.now()),
		trip_update: tripUpdate,
	}
	differentialToFull.write(feedEntity)
	//updateFeed()
}

const writeFull = throttle(() => {
	fs.writeFile('/app/latest.gtfs-rt.pbf.temp', differentialToFull.asFeedMessage(), err => {
		if (err) {
			logger.error(err);
		} else {
			// mv to emulate atomic write to avoid garbled reads for consumers of /gtfsrt/latest.gtfs-rt.pbf
			fs.rename('/app/latest.gtfs-rt.pbf.temp', '/app/latest.gtfs-rt.pbf', function (err) {
				if (err) logger.error(err);
				logger.info('written', differentialToFull.timeModified(), differentialToFull.nrOfEntities());
			});
		}
	});
}, 1000 * 60);

differentialToFull.on('change', () => {
	// write full feed on every update
	writeFull();
})

const createStopTimeEvent = (irisPlanTime, irisChangeTime) => {
	const changed = DateTime.fromISO(irisChangeTime).toUnixInteger();
	return {
		"time": changed,
		"delay": changed - DateTime.fromISO(irisPlanTime).toUnixInteger()
	}
}

const applyChange = (plan, change, redis) => {
	let tripUpdate = redis.get(redisKey('tripupdate', plan.irisPlan.trip_id));
	if (!tripUpdate) {
		logger.info("creating new tripUpdate", plan.matchedStopTime.trip_id)
		tripUpdate = {
			"trip": {
				"trip_id": plan.matchedStopTime.trip_id,
				"start_time": DateTime.fromISO(plan.matchedStopTime.trip_start).toLocaleString(DateTime.TIME_24_WITH_SECONDS),
				"start_date": DateTime.fromISO(plan.matchedStopTime.date).toFormat('yyyyMMdd'),
				"schedule_relationship": 0,
				"route_id": plan.matchedStopTime.route_id
			},
			"stopTimeUpdates": {}
		}
	}
	tripUpdate.stopTimeUpdates[plan.irisPlan.hash_id] = {
		"stop_sequence": plan.matchedStopTime.stop_sequence,
		"arrival": createStopTimeEvent(plan.irisPlan.arrival.planned_time, change.irisChange.arrival.changed_time),
		"departure": createStopTimeEvent(plan.irisPlan.departure.planned_time, change.irisChange.departure.changed_time),
		"stop_id": plan.matchedStopTime.stop_id,
		"schedule_relationship": 0
	}
	redis.set(redisKey('tripupdate', plan.irisPlan.trip_id), tripUpdate, 'EX', 60 * 60 * 24);
	tripUpdate.stop_time_update = Object.values(tripUpdate.stopTimeUpdates).sort((a, b) => a.stop_sequence - b.stop_sequence)
	delete tripUpdate.stopTimeUpdates
	logger.trace("updating tripUpdate", plan.matchedStopTime.trip_id)
	processTripUpdate(tripUpdate)
}

export {
	applyChange,
}
