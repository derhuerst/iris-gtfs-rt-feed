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

	// todo

	const irisPlans = subscribeToIrisPlans({
		stateRedis: redis,
		irisRedis,
	})
	for await (const _item of irisPlans) {
		const {redisMessageId, serviceDate, stopId, irisPlan} = _item
		try {
			// todo
			console.log(redisMessageId, serviceDate, stopId, 'irisPlan', inspect(irisPlan, {colors: true, depth: null}))
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
	for await (const _item of irisChanges) {
		const {redisMessageId, serviceDate, stopId, irisChange} = _item
		try {
			// todo
			console.log(redisMessageId, serviceDate, stopId, 'irisChange', irisChange)
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
