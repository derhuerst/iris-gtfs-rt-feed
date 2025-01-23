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
	const redis = await connectToRedis()

	// todo

	const irisPlans = subscribeToIrisPlans({
		redis,
	})
	for await (const [irisPlan, msgId] of irisPlans) {
		try {
			// todo
			console.log('irisPlan', irisPlan)
		} catch (err) {
			logger.error({
				error: err,
				messageId: msgId,
				irisPlan,
			}, `failed to process an IRIS plan: ${err.message}`)
			if (isProgrammerError(err)) {
				throw err
			}
		}
	}

	const irisChanges = subscribeToIrisChanges({
		redis,
	})
	for await (const [irisChange, msgId] of irisChanges) {
		try {
			// todo
			console.log('irisChange', irisChange)
		} catch (err) {
			logger.error({
				error: err,
				messageId: msgId,
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
