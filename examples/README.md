# Examples

`beacondb` is fictional, so nothing here can be right by accident.

```sh
# a faithful guide — exits 0, reports nothing
docfacts --reference reference.md --draft guide-correct.md

# the same guide with seven real mistakes — exits 1
docfacts --reference reference.md --draft guide-with-problems.md
```

The second contains, deliberately:

| | |
|---|---|
| `--verbose` | a flag that appears nowhere in the reference |
| `BEACONDB_CACHE_SIZE` | an invented environment variable |
| exit code `77` | an exit code the reference does not list |
| `DELETE /snapshot` | an endpoint that does not exist |
| `--unsafe-fsync` | the reference says it was removed |
| `beacondb reset` | the reference says there is no such command |
| `BEACONDB_PORT` | the reference says it is ignored in 3.2 |
| `--system` | belongs to `useradd`, credited to `beacondb` |
| `--workers` | given two different defaults in one document |

The correct guide uses the same features correctly — including repeating the
reference's own warnings — and reports nothing. Both halves matter: anything
can flag everything.
