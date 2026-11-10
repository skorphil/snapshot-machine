# Option A: btrbk configuration refactor

## Summary

btrbk configuration parsing, path resolution, and loading now live in a single
backend module, `packages/backend/src/shared/btrbk-config/`. The loader no
longer writes to disk, so reading the configuration no longer requires
`--allow-write`.

## Changes

| Before (`features/folder-history/`) | After (`shared/btrbk-config/`) |
| --- | --- |
| `btrbk-config-parser.ts` | `parser.ts` |
| `btrbk-config-path.ts` | `paths.ts` |
| `btrbk-config-loader.ts` | `loader.ts` (read-only) |
| `btrbk-config-parser_test.ts` | `parser_test.ts` |
| `btrbk-config-loader_test.ts` | `loader_test.ts` |
| (new) | `index.ts`: public exports |

- `folder-history/btrbk-parser.ts` is a different module (parses btrbk
  `--format=raw` command output, not the config file). It was left in place.
- `folder-history/index.ts` no longer re-exports `getConfigName`.
- `folder-history/api/list-folder-history.ts` imports `loadBtrbkConfig` and
  `VolumeConfig` from `@snapshot-machine/backend/shared/btrbk-config/index.ts`.
- `packages/backend/main.ts` imports `getConfigName` from the shared module.

## Loader behaviour

`loadBtrbkConfig()` is now purely read-only:

- If the drop-in exists, it is parsed.
- If it does not exist, `DEFAULT_CONFIG_TEMPLATE` is parsed from memory. No
  file or directory is created.

The `seedDropIn()` side effect is removed. Nothing else depended on it: the
frontend config editor already falls back to the in-memory template and writes
the file only on an explicit save, through the Root Helper.

## Test changes

- Two tests asserted the seeding behaviour and were rewritten. One now asserts
  that a missing drop-in produces an empty config and that neither the file nor
  its directory is created.
- The "cannot be written" fallback test was removed. It only covered the failed
  write path, which no longer exists.
- Net: 46 tests before, 45 after.

## Permissions

`deno task test` still passes `--allow-write` to the whole test run, so the
suite as a whole is unchanged. The config tests, however, need only
`--allow-read` plus write access to the temp directory for their fixtures:

```
deno test --allow-env --allow-read --allow-write=/tmp \
  packages/backend/src/shared/btrbk-config packages/backend/src/features/folder-history
# ok | 20 passed | 0 failed
```

Running them with no write permission at all fails, but only because the test
helpers call `Deno.makeTempDir`. The loader itself never writes.

## Verification

- `deno task lint`: clean (62 files).
- `deno task check`: exit 0.
- `deno task test`: 45 passed, 0 failed.
- `deno fmt --check` on the touched paths: clean.

## Path logic and the helper

`shared/btrbk-config/paths.ts` duplicates the drop-in constants from
`packages/helper/src/config-files.ts` (`CONFIG_DIR`, `DEV_CONFIG_DIR`). The
helper is a separate Deno package with its own `deno.json`, compiled on its own,
and it does not import from `packages/shared`. I did not change it. The
duplication is recorded in comments in `paths.ts`. Both copies must be kept in
sync.

Moving the path helpers into `packages/shared` would have been a larger change
across the helper's build. It is a reasonable follow-up if the helper is ever
allowed to import shared code.

## Follow-ups

- Consider a single source for the drop-in directory constants shared by the
  helper and the backend.
- The loader's read path still uses `Deno.stat` and `parseConfig`. Those are
  read-only and need only `--allow-read`.
