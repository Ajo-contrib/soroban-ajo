# Dependency Vulnerability & Staleness Audit

This is the first dedicated `npm audit` / `cargo audit` pass across the
monorepo, run 2026-08-24. It complements the ad-hoc correctness/architecture
review this repo has otherwise relied on — that review did not include a
systematic dependency-vulnerability sweep, and this one exists to close that
gap and give future audits a baseline to diff against.

## Scope

- `npm audit` across the npm-workspaces tree (root, `frontend`, `backend`).
- `cargo audit` against `contracts/ajo`'s `Cargo.lock`.
- `npm outdated` in `frontend` and `backend` for staleness (behind latest,
  even where not flagged as vulnerable).

## Rust: `contracts/ajo`

`cargo audit` reports **zero known vulnerabilities**. One advisory-database
warning, not a vulnerability:

- `paste v1.0.15` — [RUSTSEC-2024-0436](https://rustsec.org/advisories/RUSTSEC-2024-0436.html),
  unmaintained (author archived the repo, no CVE). Pulled in transitively via
  `soroban-wasmi` → `soroban-sdk`; not a direct dependency of this crate.
  Per [`DEPENDENCY_POLICY.md`](../contracts/ajo/docs/DEPENDENCY_POLICY.md),
  `soroban-sdk` bumps here are deliberately conservative and reviewed
  individually — not something to chase on its own for an unmaintained
  transitive crate with no active CVE. Tracked here for visibility the next
  time `soroban-sdk` is bumped.

## npm: fixed in this pass

Applied via `npm audit fix` (no `--force`, so npm only touched packages
where a compatible non-breaking version satisfies the existing `package.json`
range) plus one manual major-version bump verified separately (below):

|          | Before | After |
| -------- | ------ | ----- |
| Total    | 145    | 83    |
| Critical | 3      | 0     |
| High     | 80     | 42    |
| Moderate | 53     | 40    |
| Low      | 9      | 1     |

All three prior **critical** findings are resolved:

- **`jspdf` (backend)** — backend's `package.json` pinned `jspdf@^2.5.2`
  (`jspdf-autotable@^3.8.3`), independently of frontend's already-patched
  `^4.2.0`. Because the two packages declare different ranges, npm workspaces
  nested a separate, old, vulnerable copy under `backend/node_modules` rather
  than hoisting frontend's patched one — `npm audit fix` alone can't cross a
  major-version boundary, so this was a manual, verified bump:
  - `backend/package.json`: `jspdf` → `^4.2.1`, `jspdf-autotable` → `^5.0.8`
    (matching frontend's already-audited versions).
  - `jspdf-autotable@5` replaced its side-effect-import prototype patch
    (`import 'jspdf-autotable'` making `doc.autoTable(...)` "just work") with
    an explicit API. Verified with a standalone smoke script exercising the
    exact call pattern both backend services use
    (`new jsPDF()` → `.text()` → `.autoTable()` → `.addPage()` → `.output()`)
    before touching source — the old side-effect import left `doc.autoTable`
    undefined under v5. Fixed by switching both call sites
    (`backend/src/services/dataExportService.ts`,
    `backend/src/services/userDataExportService.ts`) to
    `import { applyPlugin } from 'jspdf-autotable'; applyPlugin(jsPDF)`,
    which is v5's documented way to restore the same `doc.autoTable(...)`
    call sites unchanged. Re-verified: smoke script passes, `tsc --noEmit`
    and `eslint` show no new errors in either file (both were already at
    zero errors before this pass; only pre-existing unrelated warnings /
    one pre-existing `prefer-const` lint error remain, at lines the diff
    never touches).
- **`shell-quote`**, **`vitest`** (dev-only) — resolved as part of the
  `npm audit fix` pass; no source changes needed.

## npm: tracked for follow-up (not fixed here)

Everything below needs a semver-major bump of the flagged package (or a
parent that pulls it in), which risks behavioral/API breaks `npm audit fix`
won't attempt automatically and this pass didn't verify against the
runtime — each needs its own scoped PR with real testing, the same way the
`jspdf` bump above was verified rather than blind-bumped.

**`@apollo/server` 4.13.0 → 5.5.1** — flagged explicitly because v4 is past
its documented end-of-life (2026-01-26; `npm install` already surfaces this
as a deprecation warning). The two advisories it fixes are moderate
(a `uuid` transitive dependency), but the EOL status is the bigger reason to
prioritize this one: no more security patches land on v4 regardless of
whether a new CVE appears. Needs its own PR — Apollo Server v4→v5 changes
plugin/middleware registration APIs, so this isn't a drop-in bump.

**OpenTelemetry / `@sentry/profiling-node` chain** (`@opentelemetry/sdk-node`
→ 0.221.0 fixes 16 advisories; `@opentelemetry/auto-instrumentations-node` →
0.79.0; `@sentry/profiling-node` → 10.70.0 fixes 10 more) — all high/moderate,
all observability/instrumentation packages, none in the request-handling hot
path. Lower urgency than Apollo given that, but the largest single chunk of
remaining advisories (42 of the 82 non-`xlsx` items are somewhere in this
chain) — worth doing as one coordinated bump since these packages pin
each other's peer versions.

**`mjml` 4.18.0 → 5.4.0** (and all `mjml-*` subpackages) — email-template
rendering, used wherever the backend sends transactional email. 7 high
advisories, including a directory-traversal issue
(CVE-2020-12827-adjacent) in `mj-include`. Template syntax has changed
between mjml 4 and 5; needs template-rendering output diffed before merging,
not just a compile check.

## npm: no fix available

**`xlsx` (SheetJS)** — high severity, prototype pollution
([GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6))
and ReDoS ([GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)),
**no patched version exists on any registry `xlsx` publishes to** — the
maintainer only ships fixes via their own CDN outside npm. This is a real,
directly-imported dependency (`backend/src/services/dataExportService.ts`,
`backend/src/services/userDataExportService.ts` — `import * as XLSX from
'xlsx'`, used for spreadsheet export), not a transitive/dev-only one, so
"no fix available" doesn't mean "low priority." Recommend evaluating a
replacement library (`exceljs` is the common recommendation for this exact
gap) in a follow-up issue rather than continuing to carry an unpatchable
prototype-pollution-affected package in a data-export path.

Also present with no npm-level fix, all dev/build-tooling only (no
production runtime exposure): `sharp` (via `@storybook/nextjs`'s image
pipeline), `image-size`, `@storybook/nextjs` itself.

## Staleness (not vulnerabilities, but notably behind)

From `npm outdated`, beyond what's covered above — flagged for awareness,
not urgency, since these aren't security findings:

- `next` 14.2.35 → 16.3.2 (two majors behind; also where several of the
  `high`-severity SSRF/DoS/XSS advisories above ultimately resolve)
- `react` / `react-dom` 18.x → 19.x
- `eslint` 8.x → 10.x, `@typescript-eslint/*` 6.x → 8.x
- `storybook` 8.x → 10.x
- `@prisma/client` 5.22.0 → 7.9.1

None of these are being bumped in this pass — each is its own scoped,
tested migration, consistent with how `next`/`react` majors have been
treated elsewhere in this repo's history.

## Re-running this audit

```bash
npm audit --workspaces=false   # root, hoisted view across all 3 package.jsons
cd contracts/ajo && cargo audit
```

`ci.yml`'s `npm audit` step runs with `--audit-level=high || true` — advisory
only, it cannot fail the build regardless of findings. Its `cargo audit` step
has no such guard and **would** fail CI on a real finding, which is why the
zero-vulnerability result above matters operationally, not just as a report:
this repo already has an enforced gate on the Rust side, just not the npm
side. This document is the tracking mechanism for the npm side until/unless
that changes; re-run and update the "before/after" table above the next time
a dependency pass happens rather than letting it silently drift out of date.
