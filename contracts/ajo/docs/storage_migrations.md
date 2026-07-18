# Storage upgrade and migration policy

The Ajo contract persists values whose serialized shapes are defined in
`src/types.rs`. Contract Wasm upgrades are therefore treated as storage-schema
changes unless proven otherwise.

## Current schema

`storage::CURRENT_SCHEMA_VERSION` is the single source of truth for the schema
version supported by the current Wasm. `initialize` and all group writes stamp
instance storage with that version under the `SCHEMA` key. Reads of `Group`
state call `ensure_supported_schema` and fail closed if the stored schema is not
understood by the current Wasm.

## Upgrade gate

`upgrade(new_wasm_hash, schema_version)` remains admin-authorized and now also
requires the caller to declare the storage schema that the new Wasm is compatible
with. This release only accepts `schema_version == CURRENT_SCHEMA_VERSION`, which
enforces an additive-only upgrade policy for all persisted types in `types.rs`.
Non-additive changes must not be shipped through this entrypoint until a
migration is implemented and tested.

## Future non-additive migrations

For a future `vN -> vN+1` migration:

1. Add legacy contract types for every changed persisted shape.
2. Add an eager or lazy migration function that reads vN values, writes vN+1
   values, and updates `SCHEMA` only after all writes succeed.
3. Update reads to accept only the new version after migration.
4. Add an upgrade simulation test that populates vN state, attempts the upgrade,
   runs the migration, and proves all existing data can be read back intact.

Without those steps, upgrades that declare a different schema version are safely
rejected instead of silently corrupting or bricking existing state.
