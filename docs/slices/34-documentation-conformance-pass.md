# Documentation Conformance Pass Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Make the docs accurately describe the implemented V1 authoring and runtime behavior, including limitations and provisional areas.

## Non-goals

- Do not write broad marketing docs.
- Do not document future features as shipped behavior.
- Do not invent stable API guarantees beyond current implementation.
- Do not add new product concepts in docs without code support.

## User Outcome

As an app author or maintainer, I can read the docs and understand exactly how the V1 run-first API behaves today.

## Architecture Impact

- No code changes are required unless docs uncover implementation drift.
- Clarifies the public conceptual model for app registries, runtime binding, durable effects, replay, child threads, and tool outputs.
- Identifies provisional features and non-goals for post-merge work.

## Implementation Plan

1. Review `docs/declarative-api.md` against current code.
2. Review `docs/event-taxonomy.md` against current event schemas.
3. Review architecture docs and README files for outdated planner-first language.
4. Review slice docs for status, shipped behavior, and follow-up accuracy.
5. Add explicit limitations for replay, raw side effects, parallel durable effects, and future capabilities.
6. Remove or qualify overclaims about capabilities, Effect internals, workflow backends, full policy engines, and API freeze.
7. Link the upgrade guide once it exists.

## Test Plan

- Docs review checklist must be completed.
- Code snippets should typecheck where practical or be copied from tested examples.
- Run `npm run typecheck` after any snippet-bearing example changes.
- Run `npm test` if docs changes cause code or test fixture updates.

## Acceptance Criteria

- [x] Docs state that `weave({...})` returns an app definition or registry.
- [x] Docs state that runtime binding is explicit.
- [x] Docs describe `agent.run` as replay-based, not continuation persistence.
- [x] Docs explain stable durable keys and identity by `threadId`, `scopeKey`, and `stepKey`.
- [x] Docs explain that raw side effects inside `agent.run` are unsafe.
- [x] Docs explain that new tools return raw domain outputs and old envelopes are legacy compatibility.
- [x] Docs describe `ctx.emit`, `ctx.uuid`, and `ctx.checkpoint` replay semantics precisely.
- [x] Docs state that parallel durable effects are unsupported.
- [x] Docs avoid overclaiming future capabilities, Effect runtime, workflow backend, or full policy engine maturity.

## Progress

- [x] Review declarative API docs.
- [x] Review event taxonomy docs.
- [x] Review architecture and README docs.
- [x] Review slice docs.
- [x] Update wording and limitations.
- [x] Run verification where needed.

## Completion Notes

Shipped behavior:

- Reviewed `docs/declarative-api.md`, `docs/event-taxonomy.md`, `docs/architecture.md`, `README.md`, and current slice status docs against the implemented V1 branch.
- Updated V1 limitations to include implemented child-thread helpers and to remove stale child-dispatch-as-planned wording.
- Clarified that `ctx.uuid` is provisional before a future stability milestone, not an announced API freeze.
- Clarified that parallel durable effect guardrails apply to all suspending durable effects, including child-thread effects.
- Qualified capabilities as future work in architecture and declarative API docs.
- Updated event taxonomy to document legacy top-level tool completion envelope normalization.
- Updated the root README current implementation list to reflect run-first agents, `agent-runner`, `tool-worker`, child session services, and current example locations.

Changed docs:

- `docs/declarative-api.md`
- `docs/event-taxonomy.md`
- `docs/architecture.md`
- `README.md`

Commands run:

- `npm test`
- `npm run typecheck`

Known docs gaps:

- The upgrade guide is still pending in `36-api-refactor-upgrade-guide.md`.
- Example-specific README coverage remains part of `35-example-quality-audit.md`.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/architecture.md`
- [x] `README.md`
