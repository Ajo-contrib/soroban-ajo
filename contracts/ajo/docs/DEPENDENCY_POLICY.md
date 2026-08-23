# Dependency Update Policy — `contracts/ajo`

This crate compiles to the on-chain Wasm binary that custodies real financial
value for Ajo groups. That raises the cost of a dependency-related build break
or, worse, a silent behavioral change, well above what's typical for the rest
of this monorepo. This document defines a stricter, more conservative policy
for this crate specifically.

## Why this crate is different

- **Prior incident:** this repo has already had a real build break traced to
  dependency-version drift in the `ChaCha20Rng` / `ed25519-dalek` dependency
  chain — a transitive version mismatch that only surfaced once a lockfile was
  regenerated, not when `Cargo.toml` was edited.
- **SDK behavior can shift between minor versions.** Soroban SDK's
  `#[contracterror]` macro, for example, enforces variant-count/size limits
  that are exactly the kind of detail that could change between minor SDK
  releases without a matching major version bump. A contract that compiles
  and passes tests against SDK 21.x today is not guaranteed to behave
  identically against a different 21.y.
- Frontend/backend dependencies are comparatively cheap to roll back (redeploy
  a previous build). A contract Wasm that behaves subtly differently after
  deployment is not something you can quietly revert.

## The policy

1. **Exact version pins, not ranges.** `Cargo.toml` in this crate pins
   `soroban-sdk` (and any future security- or consensus-relevant dependency)
   with `=` (e.g. `soroban-sdk = "=21.7.7"`), not a caret range. This is
   intentionally stricter than `Cargo.lock` alone: it means a version bump
   shows up as a visible, reviewable diff in `Cargo.toml`, rather than being
   something a routine `cargo update` could pick up silently the next time the
   lockfile is regenerated.
2. **Never run bare `cargo update` in this crate.** Do not run
   `cargo update` (with no arguments) inside `contracts/ajo`. It can bump
   transitive dependencies — including crypto/RNG crates this crate never
   references directly — without any corresponding review.
3. **Dependency bumps are explicit and reviewed.** To update a dependency:
   - Edit the exact pin in `Cargo.toml` yourself, to the specific version you
     intend to move to.
   - Run `cargo update -p <crate> --precise <version>` (scoped to that one
     crate) to update `Cargo.lock` to match.
   - Read the release notes / changelog for that version, specifically
     looking for changes to macro behavior (`#[contracterror]`,
     `#[contracttype]`, `#[contractimpl]`), serialization format, or crypto
     primitives.
   - Run the full test suite (`cargo test --locked`) and a clean release
     build (`cargo build --locked --target wasm32-unknown-unknown --release`)
     before opening a PR.
   - Note the version bump and rationale in `CHANGELOG.md` under
     `[Unreleased]`.
   - Get the change reviewed like any other contract-behavior change — a
     dependency bump PR should not be treated as routine chore work in this
     crate, even though it would be elsewhere in the monorepo.
4. **CI enforces `--locked`.** `cargo build`, `cargo test`, and
   `cargo clippy` all run with `--locked` in CI, so an out-of-date or
   accidentally-modified `Cargo.lock` fails the build instead of silently
   resolving to different versions.

## Scope

This policy applies to `contracts/ajo` only. `frontend`, `backend`, and other
packages in this monorepo may continue to use normal semver ranges and
routine dependency update workflows.
