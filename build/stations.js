import {ok} from 'node:assert/strict'
import {readFullStations} from 'db-hafas-stations'
import {normalizeStationName} from '../lib/normalize-station-name.js'

process.stdout.write(`[`)
let first = true

for await (const _station of readFullStations()) {
	const evaNr = _station.id
	ok(evaNr, `station without an evaNr/.id: "${_station.name}"`)

	const station = {
		evaNr,
		name: _station.name ?? null,
		normalizedName: normalizeStationName(_station.name, _station.location ?? null),
		latitude: _station.location?.latitude ?? null,
		longitude: _station.location?.longitude ?? null,
	}

	process.stdout.write(`\n${first ? '' : ', '}${JSON.stringify(station)}`)
	first = false
}

process.stdout.write(`\n]\n`)
