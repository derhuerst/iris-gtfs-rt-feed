#!/bin/bash

set -eu -o pipefail
cd "$(dirname $0)"
set -x

node stations.js >../lib/stations.json
