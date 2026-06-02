# Migration And Legacy Compatibility Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
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

- [ ] Old tool completion envelopes remain readable in summaries and timelines.
- [ ] New domain-shaped tool outputs replay through `ctx.tool` without `.data`.
- [ ] Missing `scopeKey`, `stepKey`, and lineage fields do not crash readers or projections.
- [ ] Legacy planner-authored flows still work where supported.
- [ ] Run-first replay does not treat unrelated legacy events as durable effect matches.
- [ ] Fresh and non-reset migration paths are verified.

## Progress

- [ ] Add legacy completion fixtures.
- [ ] Add new completion fixtures.
- [ ] Add missing-field fixtures.
- [ ] Add migration smoke coverage.
- [ ] Update docs with compatibility notes.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- compatibility behavior proven
- migration commands or harness used
- event shapes covered
- commands run
- known compatibility gaps

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md`
- [ ] upgrade or migration guide
