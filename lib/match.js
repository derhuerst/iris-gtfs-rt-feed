import {createLogger} from './logger.js'
import {connectToRedis} from './redis.js'
import {
	subscribeToIrisPlans,
	subscribeToIrisChanges,
} from './iris.js'
import {
	isProgrammerError,
} from './util.js'

const logger = createLogger('matching', {
	level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
})

const matchIrisMessages = async (cfg, opt = {}) => {
	// for state of our service
	const redis = await connectToRedis()
	// the Redis instance to pull IRIS data from
	const irisRedis = await connectToRedis(process.env.REDIS_URL_IRIS || process.env.REDIS_URL)

	const {
		logger: serviceLogger,
	} = cfg
	ok(serviceLogger)

	const {
		matchConcurrency,
	} = {
		matchConcurrency: process.env.MATCHING_CONCURRENCY
			? parseInt(process.env.MATCHING_CONCURRENCY)
			// this makes assumptions about how PostgreSQL scales
			// todo: query the *PostgreSQL server's* nr of cores, instead of the machine's that hafas-gtfs-rt-feed runs on
			// todo: lib/db.js uses pg.Pool, which has a max connection limit, so this option here is a bit useless...
			// but it seems there's no clean way to determine this
			//     CREATE TEMPORARY TABLE cpu_cores (num_cores integer);
			//     COPY cpu_cores (num_cores) FROM PROGRAM 'sysctl -n hw.ncpu';
			//     SELECT num_cores FROM cpu_cores LIMIT 1
			// same as with hafas-gtfs-rt-feed: https://github.com/derhuerst/hafas-gtfs-rt-feed/blob/8.2.6/lib/match.js#L54-L61
			// same as with OpenDataVBB/gtfs-rt-feed: https://github.com/OpenDataVBB/gtfs-rt-feed/blob/12fc305312ef9b2e7526deeb63d962bac2542c8a/lib/match.js#L77-L87
			: Math.ceil(1 + osCpus().length * 1.2),
		...opt,
	}

	const {
		matchIrisPlansAndChangesWithScheduleStopTimes,
		stop: stopMatching,
	} = await createMatchIrisItems({
		logger,
		redis: redis,
	})

	const subscribeAndMatch = (subscribeFn, storeFn, startMessageId, payloadField, kind) => {
		let keepProcessing = true
		;(async () => {
			const irisItems = subscribeFn({
				stateRedis: redis,
				irisRedis,
			}, {
				start: startMessageId || null,
			})
			for await (const irisItem of irisItems) {
				const {redisMessageId} = irisItem
				try {
					const {stopId} = irisItem
					const irisPayload = irisItem[payloadField]

					const {
						tripId: irisTripId,
						tripStart: irisTripStart,
					} = parseIrisTimetableStopId(irisPayload.raw_id)

					await storeFn(redis, irisPayload)
					// todo: with a new plan, match with GTFS. with a new change, just match with cached matched plan
					const {
						todo
					} = await matchIrisPlansAndChangesWithScheduleStopTimes({irisTripId, irisTripStart})
				} catch (err) {
					logger.error({
						error: err,
						redisMessageId,
						irisItem,
					}, `failed to process an IRIS ${kind}: ${err.message}`)
					if (isProgrammerError(err)) {
						throw err
					}
				}

				if (!keepProcessing) break
			}
		})()
		.catch((err) => {
			logger.error(err)
			stop()
		})

		const stop = () => {
			keepProcessing = false
		}
		return {stop}
	}

	const {
		stopProcessing: stopMatchingIrisPlans,
	} = subscribeAndMatch(
		subscribeToIrisPlans,
		storeIrisPlanInRedis,
		process.env.IRIS_PLANS_REDIS_MESSAGE_ID || null,
		'irisPlan',
		'plan Timetable',
	)
	const {
		stopProcessing: stopMatchingIrisChanges,
	} = subscribeAndMatch(
		subscribeToIrisChanges,
		storeIrisChangeInRedis,
		process.env.IRIS_CHANGES_REDIS_MESSAGE_ID || null,
		'irisChange',
		'change Timetable',
	)

	const stop = () => {
		stopMatchingIrisPlans()
		stopMatchingIrisChanges()
		stopMatching().catch(abortWithError)
	}
	withSoftExit(stop)
}

export {
	matchIrisMessages,
}
