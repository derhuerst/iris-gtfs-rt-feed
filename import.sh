#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"

export GTFS_DOWNLOAD_USER_AGENT="${GTFS_DOWNLOAD_USER_AGENT:-derhuerst/iris-gtfs-rt-feed GTFS import}"
# see also https://eu.data.public-transport.earth/#gtfs-feeds
export GTFS_DOWNLOAD_URL="${GTFS_DOWNLOAD_URL:-https://data.public-transport.earth/gtfs/de}"
export GTFS_IMPORTER_DB_PREFIX="${GTFS_IMPORTER_DB_PREFIX:-delfi_gtfs}"
export GTFS_TMP_DIR="${GTFS_TMP_DIR:-"$PWD/gtfs"}"
export GTFS_POSTPROCESSING_D_PATH="${GTFS_POSTPROCESSING_D_PATH:-"$PWD/gtfs-postprocessing.d"}"
# The DELFI GTFS often has errors: https://github.com/mfdz/GTFS-Issues/issues?q=is%3Aissue%20label%3ADELFI%20
export GTFSTIDY_BEFORE_IMPORT="${GTFSTIDY_BEFORE_IMPORT:-true}"

set -x

./postgis-gtfs-importer/importer.js
