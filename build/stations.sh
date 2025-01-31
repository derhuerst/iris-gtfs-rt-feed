#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

qsv search -d ';' \
	-s db_id '.+' \
	../trainline-stations/stations.csv \
	| qsv select name,db_id \
	| qsv rename name,evaNr \
	| qsv tojsonl -q \
	| jq -rc '. |= . + {"evaNr": (.evaNr | tostring)}' \
	| jq -rs \
	| sponge ../lib/stations.json
