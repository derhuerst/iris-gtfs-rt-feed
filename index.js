import {createLogger} from './lib/logger.js'
import {matchIrisMessages} from './lib/match.js'

const logger = createLogger('index')

try {
	await matchIrisMessages({
	})
} catch (err) {
	logger.error(err)
	process.exit(1)
}
