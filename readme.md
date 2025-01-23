# iris-gtfs-rt-feed

Continuously **realtime transit data from [Deutsche Bahn's IRIS API](https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables/api/26494) against a [GTFS Schedule](https://gtfs.org/schedule/) dataset and generates [GTFS Realtime (GTFS-RT)](https://gtfs.org/realtime/) data**.

![ISC-licensed](https://img.shields.io/github/license/derhuerst/iris-gtfs-rt-feed.svg)
[![support me via GitHub Sponsors](https://img.shields.io/badge/support%20me-donate-fa7664.svg)](https://github.com/sponsors/derhuerst)
[![chat with me via Matrix](https://img.shields.io/badge/chat%20with%20me-via%20Matrix-000000.svg)](https://matrix.to/#/@derhuerst:matrix.org)

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
