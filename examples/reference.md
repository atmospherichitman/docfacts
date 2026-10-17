# beacondb 3.2 — operator reference

beacondb is an append-only event store. It listens on a TCP port and
serves a small HTTP API for health and snapshots.

## Commands

    beacondb serve               Start the server. Foreground only.
    beacondb check               Validate the config and exit. Changes nothing.
    beacondb compact             Reclaim space from superseded events.

There is no "beacondb reset" command. Clearing the store means stopping the
service and deleting the data directory, which destroys every event.

## Flags

    --config <path>     Config file. Default: /etc/beacondb/beacondb.toml
    --port <n>          Listen port. Default: 8080. Maximum: 65535.
    --workers <n>       Worker threads. Default: 4. Maximum: 32.
    --legacy-index      Write the 2.x index alongside the 3.x one. This flag is
                        deprecated and will be removed in 4.0.

--unsafe-fsync was removed in 3.2. There is no --unsafe-fsync flag any more,
and passing it is an error.

## Environment

    BEACONDB_DATA_DIR    Data directory. Default: /var/lib/beacondb
    BEACONDB_LOG_LEVEL   One of: error, warn, info, debug. Default: info.

BEACONDB_PORT is ignored in 3.2; use --port instead.

## HTTP API

    GET /health          Returns 200 when the store is writable.
    POST /snapshot       Takes a snapshot. Returns 202 and a snapshot id.

## Exit codes

    0    Success, or --config validated by "beacondb check".
    20   The config file is unreadable or invalid.
    21   The listen port is already in use.

## Installation

Create the service account first:

    useradd --system --shell /usr/sbin/nologin beacondb

The data directory must be owned by that user. Compaction rewrites the index
in place and cannot be interrupted safely; stop writes before running it.
