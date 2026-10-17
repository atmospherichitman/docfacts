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
