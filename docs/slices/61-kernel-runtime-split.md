# Kernel / Runtime Split Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-17`
- Owner: `weave-core`

## Goal

Make the durable kernel a standalone, provable layer: move the replay/agent layer into `src/runtime/`, leave the bare `weave` entry exporting kernel-only contracts, and forbid kernel-to-runtime imports so a host can build directly on the durable log.

## Non-goals

- Promoting `weave/runtime` into a separate npm package (still an in-package subpath; see release readiness).
- Removing or rewriting the replay/agent layer. It stays intact behind `weave/runtime`.
- Changing the event model, engine contract, or any runtime behavior. This is a placement-and-boundary refactor.

## User Outcome

As a host author (Blade), I can depend on `weave` and `weave/postgres` and get the durable thread/record/coordination core with no agent-authoring or replay machinery pulled in, and a static check guarantees the kernel cannot regress into depending on the runtime.

## Architecture Impact

- Weave primitives: no behavioral change. Directory placement only.
  - Kernel stays in `src/`: `events`, `contracts`, `postgres-engine`, `thread-service`, `migrate`, `db`, `artifacts`, `summary`, `timeline`, `errors`, `internal-effect`, `types`, `thread-ref`, `observability`, `postgres-observability`, `otlp-observability`, `auth-gateway`, `auth-provider-adapter`, `auth-audit`.
  - Runtime moved to `src/runtime/`: `agent-contract`, `agent-runner`, `runner`, `daemons`, `app-contract`, `runtime`, `policy-contract`, `tool-contract`, `tool-worker`, `capability-contract`, `credentials`, `workspace-provider`, `integration-contract`, `api-server`, `opencode-adapter`, `mock-agent`, `mock-tool-worker`.
- Entries: `weave` (`.`) is kernel-only. `weave/runtime` re-exports kernel plus all runtime (strict superset). `weave/postgres` and `weave/auth` are kernel-only. `weave/server`, `weave/testing`, `weave/opencode` are runtime-facing.
- New backward edge removed: `thread-service` referenced the agent-contract `ThreadRef` type. Extracted to a kernel-owned `src/thread-ref.ts`; `agent-contract` now re-exports it.
- Boundary enforcement: `.dependency-cruiser.cjs` rule `core-no-runtime` forbids any `src/*.ts` (except the runtime-facing entry barrels) from importing `src/runtime/`. Wired into `npm run lint:boundaries` and chained into `typecheck`.
- Event taxonomy / tool contracts / artifacts / gates / policy / credentials / integrations: unchanged.

This extends slice `07-package-subpaths-runtime-boundary` (which separated authoring from runtime/storage/server/testing via export shape) by making the separation a physical directory split with a kernel-only root entry and a statically enforced boundary.

## Implementation Plan

1. Extract `ThreadRef` into `src/thread-ref.ts` to remove the one kernel→agent-contract type edge.
2. `git mv` the 17 runtime modules into `src/runtime/`.
3. Rewrite `src/index.ts` to export kernel modules only; rewrite `src/runtime-entry.ts` to export kernel + all runtime.
4. Add `.dependency-cruiser.cjs` with the `core-no-runtime` rule; add `lint:boundaries`; chain into `typecheck`; add the `dependency-cruiser` devDependency.
5. Repoint authoring imports in tests and examples to `weave/runtime`.
6. Verify kernel typecheck, boundary lint, consumer (Blade) typecheck, core tests, and example typechecks.

## Test Plan

- Kernel `tsc --noEmit` passes.
- `npm run lint:boundaries` passes, and an injected `kernel → src/runtime/` import is caught as an error (negative proof).
- `grep` confirms no kernel module imports `src/runtime/`.
- Consumer Blade `tsc --noEmit` is unchanged (resolves entirely from `weave` and `weave/postgres`).
- Core test suite passes against Postgres.
- Example workspaces typecheck.

## Acceptance Criteria

- [x] `weave` entry exposes kernel contracts only; authoring/runtime symbols are absent.
- [x] `weave/runtime` exposes the full authoring + runtime surface and re-exports the kernel.
- [x] `core-no-runtime` boundary rule is enforced and demonstrably catches violations.
- [x] Blade typechecks unchanged on kernel-only imports.
- [x] Core tests and example typechecks pass.

## Progress

- [x] Extract `ThreadRef` to the kernel.
- [x] Move runtime modules to `src/runtime/`.
- [x] Kernel-only `index.ts` + superset `runtime-entry.ts`.
- [x] dependency-cruiser boundary rule + npm scripts.
- [x] Repoint tests/examples to `weave/runtime`.
- [x] Full verification.

## Completion Notes

Shipped in submodule commit `4bea2a7` (70 files, +204/-158).

- Shipped behavior: kernel-only `weave` entry; runtime behind `weave/runtime`; `core-no-runtime` boundary enforced by dependency-cruiser.
- Public API smoke test (`src/tests/public-api-exports.test.ts`) updated to import authoring from `weave/runtime` and to assert the `weave` root does not expose `agent`, `tool`, `weave`, `defineWeaveApp`, `capability`, `policy`, `defineEvent`, `integration`, `ThreadRunner`, or `GitWorktreeWorkspaceProvider`.
- Tests added/changed: `public-api-exports.test.ts` (negative-surface assertions), `opencode-adapter.test.ts` (repointed import + corrected moved path; also fixed a pre-existing macOS `/var`→`/private` worktree-root failure via `realpath`).
- Commands run: kernel `tsc --noEmit` (clean); `npm run lint:boundaries` (clean, plus a verified violation-catch); boundary `grep` (0 hits); Blade `tsc --noEmit` (exit 0, unchanged); core tests against `postgres://steel:steel@localhost:5544/steel` (12/12); five example workspaces typechecked directly.
- Known gaps: `credentials` and `capability-contract` currently live in `src/runtime/`; if brokered credentials become a kernel routing primitive they would move back. `weave/runtime` is still an in-package subpath, not a separate npm package.
- Follow-up: docs conformance for the split (this pass); packaging decision for OSS publication recorded in `docs/release-readiness.md`.

## Docs To Update On Completion

- [x] this slice document
- [x] relevant Weave architecture docs (`docs/architecture.md`: kernel/runtime separation + per-thread coordination fencing)
- [x] glossary (`Weave Kernel`, `Weave Runtime`, `Append Fencing`)
- [x] README (`Package Boundaries`, `Implementation Map`, authoring example)
- [x] `agent.md` code landmarks
- [x] slice index (`docs/slices/README.md`)
