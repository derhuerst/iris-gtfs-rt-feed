# iris-gtfs-rt-feed

Continuously **realtime transit data from [Deutsche Bahn's IRIS API](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables/api/26494) against a [GTFS Schedule](https://gtfs.org/schedule/) dataset and generates [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime/) data**.

![ISC-licensed](https://img.shields.io/github/license/derhuerst/iris-gtfs-rt-feed.svg)
[![support me via GitHub Sponsors](https://img.shields.io/badge/support%20me-donate-fa7664.svg)](https://github.com/sponsors/derhuerst)
[![chat with me via Matrix](https://img.shields.io/badge/chat%20with%20me-via%20Matrix-000000.svg)](https://matrix.to/#/@derhuerst:matrix.org)


## How *matching* works

This service reads IRIS-formatted JSON messsges from two [Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/).

1. It assumes that it will first receive IRIS *plans*, which delineates a trip's stopover (it stopping at a stop at a specific date and time), usually latest at the beginning of its *service day*.
2. While the trip is running (or is about to start running), it expects IRIS *changes*, which provide (near-)realtime updates for the respective stopovers, e.g. delays and cancellations.

This an example of an IRIS *plan* message:

```json5
// To be more readable, this example only contains essential fields. In practice, there are more.
{
	"serviceDate": "2025-01-30",
	"stopId": "8006098",
	"irisPlan": {
		"raw_id": "9187255234335594190-2501302250-5",
		"date_id": "2025-01-30T21:50:00+00:00",
		"stop_sequence_id": 5,
		"trip_label": {
			"category": "VIA",
			"filter": "D",
			"number": "20040",
			"owner": "R4NRN",
			"type": "p",
		},
		"arrival": {
			"line": "RE19",
			"planned_path": [
				"Oberhausen Hbf",
				"Oberhausen-Sterkrade",
				// …
			],
			"planned_platform": "2",
			"planned_time": "2025-01-30T22:07:00+00:00",
		},
		"departure": {
			"line": "RE19",
			"planned_path": [
				"Wesel",
				"Wesel Feldmark",
				// …
			],
			"planned_platform": "2",
			"planned_time": "2025-01-30T22:08:00+00:00",
		},
	},
}
```

Upon receiving it, `iris-gtfs-rt-feed` will store the *plan* in Redis.

This an example of a corresponding IRIS *change* message:

```json5
// To be more readable, this example only contains essential fields. In practice, there are more.
{
	"serviceDate": "2025-01-30",
	"stopId": "8006098", // Voerde(Niederrhein)
	"irisChange": {
		"raw_id": "9187255234335594190-2501302250-5",
		"stop_sequence_id": 5,
		"arrival": {
			"changed_time": "2025-01-30T22:10:00+00:00",
		},
		"connection": null,
		"date_id": "2025-01-30T21:50:00+00:00",
		"departure": {
			"changed_time": "2025-01-30T22:11:00+00:00",
		},
	},
}
```

Upon receiving the *change*, `iris-gtfs-rt-feed` tries to match the trip's *plans* with the GTFS Schedule data.

If there is **exactly one such GTFS Schedule trip "instance" – we call it a *match* –**, it will proceed. If there are >1 trip "instances", we consider the the match *ambiguous* and not specific enough, and stop further processing until the next IRIS message for this trip is received.

The service then generates a GTFS-RT `TripUpdate` from both the IRIS *plans* and the matched GTFS Schedule data, and applies the delays and cancellations from the IRIS *changes* to it.

The resulting `TripUpdate` will look like this:

```js
// Again, this example has been shortened for readability.
{
	trip: {
		route_id: '3399444_106',
		trip_id: '2733665562',
		direction_id: 1,
		schedule_relationship: 0,
	},
	stop_time_update: [
		{
			// This StopTimeUpdate contains information merged from *two* three sources:
			// - from GTFS Schedule: schedule_relationship, stop_sequence, stop_id
			// - from IRIS plan: kIrisStopId, arrival.time, departure.time
			schedule_relationship: ScheduleRelationship.SCHEDULED,
			stop_sequence: 0,
			stop_id: 'de:05111:18235:91:7', // Düsseldorf Hbf
			// [kIrisStopId]: '8000085', // Düsseldorf Hbf
			arrival: {
				time: 1738272360, // 2025-01-30T22:26:00+01:00
				delay: null,
			},
			departure: {
				time: 1738272360, // 2025-01-30T22:26:00+01:00
				delay: null,
			},
		},
		// …
		{
			// This StopTimeUpdate contains information merged from all three sources:
			// - from GTFS Schedule: schedule_relationship, stop_sequence, stop_id
			// - from IRIS plan: kIrisStopId, arrival.time, departure.time
			// - from IRIS change: arrival.delay, departure.delay
			schedule_relationship: ScheduleRelationship.SCHEDULED,
			stop_sequence: 7,
			stop_id: 'de:05170:36966:90:DB2', // Voerde Bahnhof
			// [kIrisStopId]: '8006098', // Voerde(Niederrhein)
			arrival: {
				time: 1738275000, // 2025-01-30T23:10:00+01:00
				delay: 180,
			},
			departure: {
				time: 1738275060, // 2025-01-30T23:11:00+01:00
				delay: 180,
			},
		},
		// …
		{
			schedule_relationship: ScheduleRelationship.SCHEDULED,
			stop_sequence: 19,
			stop_id: 'NL:S:ah', // Arnhem Centraal
			// [kIrisStopId]: '8400071', // Arnhem Centraal
			arrival: {
				time: 1738278780, // 2025-01-31T00:13:00+01:00
				delay: null,
			},
			departure: {
				time: 1738278780, // 2025-01-31T00:13:00+01:00
				delay: null,
			},
		},
	]
}
```

Because this matching and `TripUpdate` generation process is repeated whenever an IRIS message appears, we get a continuous stream of the latest known state of each trip covered by IRIS.


## Installation

There is [a Docker image available](https://github.com/derhuerst/pkgs/container/iris-gtfs-rt-feed):

```shell
# Pull the Docker image …
docker pull ghcr.io/derhuerst/iris-gtfs-rt-feed

# … or install everything manually (you will need Node.js & npm).
git clone https://github.com/derhuerst/iris-gtfs-rt-feed.git iris-gtfs-rt-feed
cd iris-gtfs-rt-feed
npm install --omit dev
# install submodules' dependencies
git submodule update --checkout
cd postgis-gtfs-importer && npm install --omit dev
```


## Getting Started

todo



## License

This project is [ISC-licensed](license.md).
