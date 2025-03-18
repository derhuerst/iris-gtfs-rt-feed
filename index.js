import {createLogger} from './lib/logger.js'
import {matchIrisMessages} from './lib/match.js'

const logger = createLogger('service')

try {
	await matchIrisMessages({
		logger,
	})
} catch (err) {
	logger.error(err)
	process.exit(1)
}
