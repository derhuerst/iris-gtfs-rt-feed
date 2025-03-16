import {createLogger} from './logger.js'
import {connectToRedis} from './redis.js'
import {
	subscribeToIrisPlans,
	subscribeToIrisChanges,
} from './iris.js'
import {
	isProgrammerError,
} from './util.js'
import {createMatchIrisPlan} from './match-iris-plan-with-gtfs-schedule.js'
import {applyChange} from './gtfsrt.js'

import {MAJOR_VERSION} from './major-version.js'

const redisKey = (keyType, id) => {
	return MAJOR_VERSION + ':' + keyType + ':' + id;
}

const logger = createLogger('matching', {
	level: (process.env.LOG_LEVEL_MATCHING || 'warn').toLowerCase(),
})

const {
	matchIrisPlanWithScheduleStopTimes,
	stop,
} = await createMatchIrisPlan({
	logger: logger,
})

const matchIrisMessages = async (cfg, opt = {}) => {
	logger.info("starting...")
	// for state of our service
	const redis = await connectToRedis()
	logger.info("connected to state redis", await redis.get('smoke'), await redis.dbsize())
	// the Redis instance to pull IRIS data from
	const irisRedis = await connectToRedis(process.env.REDIS_URL_IRIS || process.env.REDIS_URL)
	logger.info("connected to iris redis")

	// todo pg/gtfs

	const irisPlans = subscribeToIrisPlans({
		stateRedis: redis,
		irisRedis,
	})
	logger.info('subscribed plans')
	for await (const _item of irisPlans) {
		logger.debug('received plan')
		const {redisMessageId, serviceDate, stopId, irisPlan} = _item
		try {
			logger.trace(redisMessageId, serviceDate, stopId, 'irisPlan', inspect(irisPlan, {colors: true, depth: null}))
			const {
				matchedStopTime,
				isMatched,
			} = await matchIrisPlanWithScheduleStopTimes(irisPlan)
			const plan = {serviceDate, stopId, irisPlan, matchedStopTime}
			await redis.set(redisKey('plan', irisPlan.hash_id), plan, 'EX', 60 * 60 * 24)
			if (isMatched) {
				const existingChange = await redis.getdel(redisKey('change', irisPlan.hash_id))
				if (existingChange) {
					logger.debug("apply existing change to new plan")
					applyChange(plan, existingChange, redis)
				}
			}
		} catch (err) {
			logger.error({
				error: err,
				redisMessageId,
				serviceDate,
				stopId,
				irisPlan,
			}, `failed to process an IRIS plan: ${err.message}`)
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}

	const irisChanges = subscribeToIrisChanges({
		stateRedis: redis,
		irisRedis,
	})
	logger.info('subscribed changes')
	for await (const _item of irisChanges) {
		logger.debug('received change')
		const {redisMessageId, serviceDate, stopId, irisChange} = _item
		try {
			logger.trace(redisMessageId, serviceDate, stopId, 'irisChange', irisChange)
			const existingPlan = await redis.get(redisKey('plan', irisChange.hash_id))
			const change = {serviceDate, stopId, irisChange}
			if (existingPlan) {
				applyChange(existingPlan, change, redis)
			} else {
				logger.debug('change has overtaken plan, storing for later...')
				await redis.set(redisKey('change', irisChange.hash_id), change, 'EX', 60 * 15)
			}
		} catch (err) {
			logger.error({
				error: err,
				redisMessageId,
				serviceDate,
				stopId,
				irisChange,
			}, `failed to process an IRIS change: ${err.message}`)
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}
}

export {
	matchIrisMessages,
}
