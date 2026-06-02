# Public API Export Audit Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Verify that V1 authoring and runtime package exports are intentional, usable, and stable enough for merge.

## Non-goals

- Do not redesign package names.
- Do not remove legacy `define*` helpers in this slice.
- Do not expose new testing helpers unless the slice explicitly decides to add them.
- Do not promise a permanent API freeze beyond the documented V1 boundary.

## User Outcome

As an app author, I can import authoring primitives from `weave` and runtime/storage/server helpers from subpaths without relying on internal source paths.

## Architecture Impact

- Exercises the root `weave` export as the authoring boundary.
- Exercises `weave/runtime`, `weave/postgres`, `weave/server`, and `weave/testing` as explicit deployment and test boundaries.
- Clarifies whether `weave/testing` remains limited to mocks or grows a `createTestWeave` helper.
- No event taxonomy or database changes are expected.

## Implementation Plan

1. Add a public API smoke test or fixture that imports from the package export paths.
2. Import root authoring primitives: `agent`, `tool`, `weave`, `integration`, and legacy `define*` aliases.
3. Import runtime primitives from `weave/runtime`: `createWeaveRuntime`, `ThreadRunner`, `ContractToolWorker`, and `ThreadService` if intended.
4. Import storage primitives from `weave/postgres`: `PostgresThreadEngine`, `createPool`, and `migrate`.
5. Import server primitives from `weave/server`: `createApiServer` and intended server types.
6. Import testing primitives from `weave/testing` and decide whether a new `createTestWeave` helper belongs there.
7. Assert that normal app code does not need authoring types from `weave/runtime`.
8. Update docs if the actual export boundary differs from current examples.

## Test Plan

- Add `src/tests/public-api-exports.test.ts` or an equivalent package smoke fixture.
- The test should import from package names, not relative module paths.
- If the repo adds a build step later, ensure the smoke test also runs against built package output.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Root `weave` exports authoring primitives and legacy aliases.
- [x] Runtime, Postgres, server, and testing subpaths export only intentional public surface.
- [x] No accidental internal-only or Effect-only types are required for V1 authoring.
- [x] `weave/testing` has an explicit decision: keep current mocks only or add a named helper.
- [x] Docs examples use supported package paths.
- [x] Typecheck proves the import paths work through package exports.

## Progress

- [x] Write export smoke test or fixture.
- [x] Audit root export list.
- [x] Audit subpath export lists.
- [x] Decide `weave/testing` helper scope.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Added `src/tests/public-api-exports.test.ts` as a package self-reference smoke test.
- The test imports authoring primitives and legacy aliases from `weave`.
- The test imports runtime, Postgres, server, and testing utilities from `weave/runtime`, `weave/postgres`, `weave/server`, and `weave/testing`.
- `weave/testing` remains intentionally limited to mock utilities for now: `DeterministicMockAgent` and `MockAsyncToolWorker`.
- No `createTestWeave` helper was added in this slice.

Changed modules:

- `src/tests/public-api-exports.test.ts`: adds package export smoke coverage.
- `package.json`: runs the public API smoke test as part of `npm test`.
- `tsconfig.json`: adds explicit `rootDir` so TypeScript can resolve package self-reference imports through the export map.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- The package currently exports TypeScript source files directly, so the smoke test proves current package self-reference behavior. If a build step is added later, this coverage should also run against built output.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `README.md`
