#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

rm -f delfi-2025-01-27.gtfs.zip
wget -nv -U derhuerst \
	-O delfi-2025-01-27.gtfs.zip \
	'https://mirror.traines.eu/german-delfi-gtfs/2025-01-27/gtfs.zip'

ls -lh # todo: remove
rm -rf delfi-2025-01-27.filtered.gtfs
unzip -d delfi-2025-01-27.filtered.gtfs delfi-2025-01-27.gtfs.zip
# keep only trains (roughly speaking)
env QSV_SKIP_FORMAT_CHECK='true' qsv search \
	-s route_type '^[1249]' \
	delfi-2025-01-27.filtered.gtfs/routes.txt \
	| sponge delfi-2025-01-27.filtered.gtfs/routes.txt
rm delfi-2025-01-27.filtered.gtfs/shapes.txt
# fix GTFS, throw out unreferenced trips, stop_times, etc.
gtfstidy --fix --compress delfi-2025-01-27.filtered.gtfs -o delfi-2025-01-27.filtered.tidied.gtfs

env | grep '^PG' || true
psql -c 'CREATE DATABASE delfi_2025_01_27'
export PGDATABASE=delfi_2025_01_27

NODE_ENV=production gtfs-to-sql -d \
	--trips-without-shape-id \
	-- delfi-2025-01-27.filtered.gtfs/*.txt \
	| sponge | psql -q -b -v 'ON_ERROR_STOP=1'

node matching.js
