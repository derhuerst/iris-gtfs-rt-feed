import {ok} from 'node:assert/strict'
import _dbHafasStations from 'db-hafas-stations'
const {full: readFullStations} = _dbHafasStations
// import {normalizeStationName} from '../lib/normalize-station-name.js'

process.stdout.write(`[`)
let first = true

for await (const _station of readFullStations()) {
	const evaNr = _station.id
	ok(evaNr, `station without an evaNr/.id: "${_station.name}"`)

	const station = {
		evaNr,
		name: _station.name ?? null,
	}

	process.stdout.write(`\n${first ? '' : ', '}${JSON.stringify(station)}`)
	first = false
}

process.stdout.write(`\n]\n`)
