# Migration And Legacy Compatibility Slice

## Status

- Vertical: `weave-core`
- Status: `In Progress`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Prove that the V1 runtime can read and operate on representative data and events produced by the pre-refactor model.

## Non-goals

- Do not add broad data-rewrite migrations unless a compatibility gap requires one.
- Do not remove support for planner-authored agents.
- Do not force all existing events to contain `scopeKey` or `stepKey`.
- Do not change the new domain-shaped tool output format.

## User Outcome

As an operator with existing threads, I can migrate to the refactored runtime without corrupting old threads or losing readable summaries and timelines.

## Architecture Impact

- Validates old and new `tool.completed` payload shapes.
- Validates thread readers, summaries, timelines, projections, and replay behavior with missing optional fields.
- Validates migrations against both fresh and existing database states.
- No new public authoring primitive is expected.

## Implementation Plan

1. Add fixtures for old `ToolCompletionOutput`-style tool completions.
2. Add fixtures for new domain-shaped `tool.completed.payload.output` completions.
3. Add fixtures for events without `scopeKey`, `stepKey`, or lineage fields.
4. Verify summaries and timelines render both old and new completion shapes.
5. Verify planner-backed agents still operate on old-style threads where intentionally supported.
6. Verify run-first replay does not accidentally match unrelated legacy events that lack durable identity fields.
7. Add migration coverage for fresh database setup.
8. Add migration coverage for an existing main-era schema or representative pre-refactor schema.

## Test Plan

- Legacy tool completion replay or rendering test.
- New tool completion replay test proving `ctx.tool` returns raw domain output.
- Reader/projection/summary/timeline tests with missing `scopeKey` and `stepKey`.
- Migration smoke for fresh database: `migrate` without reset.
- Migration smoke for existing schema: apply current migrations over representative pre-refactor state.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Old tool completion envelopes remain readable in summaries and timelines.
- [x] New domain-shaped tool outputs replay through `ctx.tool` without `.data`.
- [x] Missing `scopeKey`, `stepKey`, and lineage fields do not crash readers or projections.
- [x] Legacy planner-authored flows still work where supported.
- [x] Run-first replay does not treat unrelated legacy events as durable effect matches.
- [ ] Fresh and non-reset migration paths are verified.

## Progress

- [x] Add legacy completion fixtures.
- [x] Add new completion fixtures.
- [x] Add missing-field fixtures.
- [ ] Add migration smoke coverage.
- [x] Update docs with compatibility notes.
- [x] Run verification.

## Progress Notes

Completed behavior:

- `tool.completed` now accepts and normalizes the older top-level `summary`, `requiresManualApproval`, and `data` envelope shape into the current `payload.output` shape.
- Legacy completion envelopes remain compatible with the old planner gate-heavy flow.
- Legacy events without `scopeKey` or `stepKey` remain readable by projection, summary, and timeline paths.
- Run-first replay does not accidentally match unrelated legacy events that lack durable identity fields.
- Existing domain-shaped tool output replay coverage continues to prove new tools return raw outputs without `.data`.

Changed modules:

- `src/events.ts`: broadens `ToolCompletedPayloadSchema` to normalize legacy top-level tool completion envelopes.
- `src/tests/replay-authoring.test.ts`: adds legacy top-level completion, legacy planner gate compatibility, and missing durable identity compatibility tests.

Commands run:

- `npm test`
- `npm run typecheck`

Remaining gap:

- Fresh and non-reset database migration coverage is still not automated in this repo. The migration SQL is idempotent through `create table if not exists` and `alter table ... add column if not exists`, but a representative pre-refactor database harness is still needed before this slice can be marked shipped.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [ ] upgrade or migration guide
