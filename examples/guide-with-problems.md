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
