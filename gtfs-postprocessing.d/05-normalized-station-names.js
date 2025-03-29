#!/usr/bin/env node

import _pg from 'pg'
const {Client} = _pg
import Cursor from 'pg-cursor'
import pgFormat from 'pg-format'
import {normalizeStationName} from '../lib/normalize-station-name.js'

const INSERT_BATCH_SIZE = 5000

const queryAllStops = async function* (db) {
	const cursor = db.query(new Cursor(`\
		SELECT
			stop_id,
			stop_name,
			st_x(stop_loc::geometry) AS stop_lon,
			st_y(stop_loc::geometry) AS stop_lat
		FROM stops
	`))

	try {
		while (true) {
			const stops = await cursor.read(10000)
			if (stops.length === 0) {
				break
			}
			for (const stop of stops) {
				yield stop
			}
		}
	} finally {
		await cursor.close()
	}
}

const readDbClient = new Client()
await readDbClient.connect()
const writeDbClient = new Client()
await writeDbClient.connect()

await writeDbClient.query(`\
BEGIN;

CREATE TABLE stops_normalized_names (
	stop_id TEXT NOT NULL REFERENCES stops,
	normalized_name TEXT NOT NULL
);
`)

let batch = new Array(INSERT_BATCH_SIZE)
let batchI = 0

let i = 0
for await (const stop of queryAllStops(readDbClient)) {
	if (i > 0 && i % 50000 === 0) {
		console.error(`${i} stations processed`)
	}
	i++

	const {
		stop_id,
		stop_name,
		stop_lat, stop_lon,
	} = stop

	const normalized_name = normalizeStationName(stop_name, {
		latitude: stop_lat,
		longitude: stop_lon,
	})

	batch[batchI++] = [stop_id, normalized_name]
	if (batchI >= INSERT_BATCH_SIZE) {
		// https://stackoverflow.com/a/63167970/1072129
		await writeDbClient.query(pgFormat(
			`\
				INSERT INTO stops_normalized_names (stop_id, normalized_name)
				VALUES %L
			`,
			batch,
		))
		batchI = 0
	}
}
console.error(`${i} stations processed`)

await writeDbClient.query(`\
CREATE INDEX ON stops_normalized_names (stop_id);
CREATE INDEX ON stops_normalized_names (normalized_name);

COMMIT;
`)

readDbClient.end()
writeDbClient.end()
