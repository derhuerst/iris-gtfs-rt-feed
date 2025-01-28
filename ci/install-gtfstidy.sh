#!/bin/bash

set -eu -o pipefail
set -x

sudo apt install -y \
	curl jq

ua='iris-gtfs-rt-feed CI'
gtfstidy_release='43293141' # v0.2
releases_url="https://api.github.com/repos/patrickbr/gtfstidy/releases/$gtfstidy_release"
assets_url="$(
	curl "$releases_url" -H 'Accept: application/json' -H "User-Agent: $ua" -L -fsS \
	| jq -r '.assets_url'
)"
gtfstidy_x64_url="$(
	curl "$assets_url" -H 'Accept: application/json' -H "User-Agent: $ua" -L -fsS \
	| jq -r '.[] | select(.name | test("gtfstidy.v[0-9.]+.linux.amd64")) | .browser_download_url'
)"

curl -o "$HOME/.local/bin/gtfstidy" "$gtfstidy_x64_url" -H "User-Agent: $ua" -L -fsS
chmod +x "$HOME/.local/bin/gtfstidy"

$HOME/.local/bin/gtfstidy --help
