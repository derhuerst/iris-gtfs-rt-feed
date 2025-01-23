import {matchIrisMessages} from './lib/match.js'

try {
	await matchIrisMessages({
	})
} catch (err) {
	logger.error(err)
	process.exit(1)
}
