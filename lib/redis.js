import {ok} from 'node:assert/strict'
import Redis from 'ioredis'

const parseRedisUrlIntoOpts = (url) => {
	const opts = {}
	url = new URL(url)
	opts.host = url.hostname || 'localhost'
	opts.port = url.port || '6379'
	if (url.username) opts.username = url.username
	if (url.password) opts.password = url.password
	if (url.pathname && url.pathname.length > 1) {
		opts.db = parseInt(url.pathname.slice(1))
	}
	return opts
}

const baseOpts = {}
if (process.env.REDIS_URL) {
	Object.assign(baseOpts, parseRedisUrlIntoOpts(process.env.REDIS_URL))
}
Object.freeze(baseOpts)

const connectToRedis = async (opt = {}) => {
	if (typeof opt === 'string') {
		opt = parseRedisUrlIntoOpts(opt)
	}
	return new Redis({
		...baseOpts,
		...opt,
	})
}

// adapted from https://github.com/redis/ioredis/blob/v5.4.2/examples/stream.js#L11-L24
const subscribeToRedisStream = async function* (redis, streamName, opt = {}) {
	ok(redis, 'redis must be passed in')
	ok(streamName, 'streamName must be passed in')
	const {
		start,
		msgsPerBatch,
		emptyBatchRetryDelay,
		binary,
		readCursor,
		writeCursor,
	} = {
		start: null,
		msgsPerBatch: 100,
		emptyBatchRetryDelay: 500, // milliseconds
		binary: false,
		readCursor: null,
		writeCursor: null,
		...opt,
	}
	const xreadMethod = binary ? 'xreadBuffer' : 'xread'

	if (readCursor) {
		ok(writeCursor, 'opt.writeCursor is required if opt.readCursor is passed in')
	}

	// `0-0` starts from the beginning, `$` starts with the latest
	let cursor = start ?? (readCursor && await readCursor()) ?? '$'
	while (true) {
		const [[_, msgs]] = await redis[xreadMethod](
			'BLOCK', '0',
			'COUNT', String(msgsPerBatch),
			'STREAMS', streamName,
			cursor,
		)
		if (msgs.length === 0) {
			await new Promise(resolve => setTimeout(resolve, emptyBatchRetryDelay))
			continue
		}

		for (const msg of msgs) {
			yield msg
		}

		const newCursor = msgs[msgs.length - 1][0].toString('utf8')
		if (writeCursor !== null) {
			await writeCursor(newCursor)
		}
		cursor = newCursor
	}
}

export {
	parseRedisUrlIntoOpts,
	baseOpts,
	connectToRedis,
	subscribeToRedisStream,
}
