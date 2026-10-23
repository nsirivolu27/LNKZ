#!/bin/sh
set -eu
# A newly mounted volume belongs to root; initialize it before dropping privileges.
mkdir -p /app/.data
chown lnkz:lnkz /app/.data
exec runuser -u lnkz -- "$@"
