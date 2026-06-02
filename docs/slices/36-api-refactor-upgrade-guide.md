# API Refactor Upgrade Guide Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Create a short migration guide for moving from planner-first and enveloped tool-output patterns to the V1 run-first authoring model.

## Non-goals

- Do not document every internal runtime detail.
- Do not promise removal dates for legacy APIs unless the project decides them.
- Do not describe future capabilities or Effect internals as required migration steps.
- Do not make syntax changes as part of writing the guide.

## User Outcome

As a maintainer of an existing Weave app, I can understand the preferred V1 style, what legacy behavior remains supported, and which limitations matter during migration.

## Architecture Impact

- No code changes are expected.
- Establishes human-readable upgrade guidance for authoring primitives, tool outputs, runtime binding, and replay safety.
- Clarifies which APIs are compatibility paths versus preferred V1 paths.

## Implementation Plan

1. Create `docs/migration/api-refactor.md` or `docs/upgrade-guide.md`.
2. Show preferred run-first agent style with `agent({ run(ctx, input) { ... } })`.
3. Show legacy planner-first style that remains supported.
4. Show tool output migration from `ToolCompletionOutput` envelope to domain-shaped output plus `summarize`.
5. Show explicit runtime binding with `createWeaveRuntime`.
6. Document stable durable key requirements.
7. Document limitations: replay-based runtime, unsafe raw side effects, unsupported parallel durable effects, Effect not required for V1 authoring, and capabilities still future or partial.
8. Link the guide from relevant docs and README files.

## Test Plan

- Review code snippets against existing APIs.
- Prefer snippets copied from typechecked examples or tests.
- Run `npm run typecheck` if any snippets are promoted into checked fixtures.
- Run docs link checks manually by reading linked files in this repo.

## Acceptance Criteria

- [x] Upgrade guide exists in an agreed docs path.
- [x] Guide shows new preferred run-first authoring style.
- [x] Guide states legacy planner style is still supported.
- [x] Guide explains tool output migration from envelope to raw domain output.
- [x] Guide explains explicit runtime binding.
- [x] Guide documents stable durable keys and replay limitations.
- [x] Guide documents known limitations and future areas without overclaiming.
- [x] Guide is linked from `docs/declarative-api.md` or `README.md`.

## Progress

- [x] Pick docs path.
- [x] Draft migration guide.
- [x] Verify snippets.
- [x] Link guide from docs.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- Added `docs/migration/api-refactor.md` as the upgrade guide path.
- Covered preferred run-first agent authoring, legacy planner compatibility, tool output migration, runtime binding, package subpaths, stable durable keys, replay safety, child threads, parallel durable effect limitations, and known limitations.
- Linked the guide from `docs/README.md`, `docs/declarative-api.md`, and the root `README.md`.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- The guide is intentionally concise and does not document every internal runtime detail.
- Removal timelines for compatibility APIs are not specified because none have been decided.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] new upgrade guide file
- [x] `docs/declarative-api.md`
- [x] `README.md`
