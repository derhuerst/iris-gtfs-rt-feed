#!/usr/bin/env bash
# This is a modified version of postgis-gtfs-importer's download.sh. It uses plain `curl` instead of curl-mirror because the latter doesn't handle AWS S3 `Content-Encoding: aws-chunked` properly. I suspect curl-mirror to have a bug but haven't investigated so far.
set -e
set -u
set -E # abort if subshells fail
set -o pipefail

source "$(dirname "$(realpath "$0")")/../postgis-gtfs-importer/lib.sh"

ua="${GTFS_DOWNLOAD_USER_AGENT:?'missing/empty $GTFS_DOWNLOAD_USER_AGENT'}"
gtfs_url="${GTFS_DOWNLOAD_URL:?'missing/empty $GTFS_DOWNLOAD_URL'}"

verbose="${GTFS_DOWNLOAD_VERBOSE:-true}"
if [ "$verbose" != false ]; then
	set -x # enable xtrace
fi

print_bold "Downloading the GTFS feed from $GTFS_DOWNLOAD_URL."

mkdir -p "$gtfs_tmp_dir"

# The following section is modified to work around the `aws-chunked` bug.
# To emulate atomic behaviour, we first download to `$zip_path.download`, then rename to `$zip_path`.
rm -f "$zip_path.download" "$zip_path"
curl \
	-fsSL \
	-H "User-Agent: $ua" \
	-o "$zip_path.download" \
	"$gtfs_url"
mv "$zip_path.download" "$zip_path"
