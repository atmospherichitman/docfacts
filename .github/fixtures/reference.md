# forge

A build tool.

## Usage

```bash
forge build --verbose --output dist
```

## Options

`--verbose`  Print each step as it runs.

`--output <dir>`  Directory to write the build into. Defaults to `build`.

## Removed options

`--legacy-cache` was removed in 2.0 and has no replacement. Builds that
passed it should pass `--output` instead.
