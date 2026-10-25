#!/usr/bin/env sh
set -eu
# Maintainer-run verification after a release. This script writes nothing.
npm view lean-computer-use version dist.attestations --prefer-online --json
