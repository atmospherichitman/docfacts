/**
 * A synthetic reference and two drafts written against it: one correct, one
 * carrying genuine errors.
 *
 * Both halves matter. A checker tested only on bad documents looks excellent
 * right up to the moment it reports a correct one, and a false finding costs
 * more trust than a missed one gains — the user can verify a finding against
 * the quoted reference in seconds, and a wrong one tells them the tool is
 * guessing.
 *
 * beacondb is fictional, so nothing here can be right by training data.
 */

export const BEACONDB_REFERENCE = `
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
`.trim();

/**
 * A draft that is faithful to the reference.
 *
 * It uses the supported flags and commands, names the deprecated one as
 * deprecated, repeats the reference's own denials as denials, attributes
 * `--system` and `--shell` to useradd, and repeats every default exactly.
 * Nothing in it should be reported.
 */
export const CORRECT_DRAFT = `
# Running beacondb 3.2

## Installing

Create a service account with no login shell:

    useradd --system --shell /usr/sbin/nologin beacondb

Then validate your configuration before starting anything:

    beacondb check --config /etc/beacondb/beacondb.toml

That exits 0 when the file is valid and 20 when it is not.

## Starting the server

    beacondb serve --port 8080 --workers 4

The config file defaults to /etc/beacondb/beacondb.toml, the port defaults to
8080, and --workers defaults to 4 with a maximum of 32. Set BEACONDB_DATA_DIR
to move the data directory away from its default of /var/lib/beacondb, and
BEACONDB_LOG_LEVEL to change verbosity from its default of info.

If the port is taken the process exits 21.

## Checking health

Poll GET /health, which returns 200 while the store is writable. Take a
snapshot with POST /snapshot.

## Maintenance

Run beacondb compact to reclaim space from superseded events. Compaction
rewrites the index in place and cannot be interrupted safely, so stop writes
first.

The --legacy-index flag writes the 2.x index as well. It is deprecated and
will be removed in 4.0, so do not add it to new deployments.

There is no --unsafe-fsync flag in 3.2. There is also no "beacondb reset"
command; clearing the store means stopping the service and deleting the data
directory, which destroys every event.
`.trim();

/**
 * A draft with seven genuine errors, one of each kind the tool claims to
 * find. Each is the sort of thing a competent writer or a capable model
 * actually produces, not a nonsense string.
 */
export const ERRONEOUS_DRAFT = `
# Running beacondb 3.2

## Installing

Create a service account:

    beacondb --system --shell /usr/sbin/nologin beacondb

## Starting the server

    beacondb serve --port 8080 --workers 8 --verbose

Pass --verbose for more detail during startup. The port defaults to 8080 and
--workers defaults to 8.

For durability on spinning disks, pass --unsafe-fsync to force a flush on
every write.

Set BEACONDB_PORT to change the listen port without editing the config.
Set BEACONDB_CACHE_SIZE to tune the read cache.

## Checking health

Poll GET /health, which returns 200. Call DELETE /snapshot to discard an old
snapshot.

## Maintenance

Run beacondb compact to reclaim space. If the index is damaged, run
beacondb reset to start again from an empty store.

Add --legacy-index if you need the 2.x index.

An unreadable config exits 20, and a corrupt index exits 77.

Later in this guide we note that --workers defaults to 4.
`.trim();

/** What the erroneous draft contains, as the report should describe it. */
export const EXPECTED_ERRORS = [
  { kind: "fabricated", token: "--verbose", why: "not in the reference at all" },
  { kind: "fabricated", token: "77", why: "an exit code the reference does not list" },
  { kind: "fabricated", token: "BEACONDB_CACHE_SIZE", why: "an invented variable in the tool's namespace" },
  { kind: "fabricated", token: "DELETE /snapshot", why: "an endpoint the reference does not have" },
  { kind: "unsupported_used", token: "--unsafe-fsync", why: "the reference says it was removed" },
  { kind: "unsupported_used", token: "beacondb reset", why: "the reference says there is no such command" },
  { kind: "unsupported_used", token: "BEACONDB_PORT", why: "the reference says it is ignored in 3.2" },
  { kind: "misattributed", token: "--system", why: "the reference gives it to useradd" },
  { kind: "internal_contradiction", token: "--workers", why: "the draft says 8 and later 4" },
] as const;
