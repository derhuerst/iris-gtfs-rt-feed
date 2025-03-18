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
