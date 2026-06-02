# Documentation Conformance Pass Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
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

- [ ] Docs state that `weave({...})` returns an app definition or registry.
- [ ] Docs state that runtime binding is explicit.
- [ ] Docs describe `agent.run` as replay-based, not continuation persistence.
- [ ] Docs explain stable durable keys and identity by `threadId`, `scopeKey`, and `stepKey`.
- [ ] Docs explain that raw side effects inside `agent.run` are unsafe.
- [ ] Docs explain that new tools return raw domain outputs and old envelopes are legacy compatibility.
- [ ] Docs describe `ctx.emit`, `ctx.uuid`, and `ctx.checkpoint` replay semantics precisely.
- [ ] Docs state that parallel durable effects are unsupported.
- [ ] Docs avoid overclaiming future capabilities, Effect runtime, workflow backend, or full policy engine maturity.

## Progress

- [ ] Review declarative API docs.
- [ ] Review event taxonomy docs.
- [ ] Review architecture and README docs.
- [ ] Review slice docs.
- [ ] Update wording and limitations.
- [ ] Run verification where needed.

## Completion Notes

Fill this in when shipped.

Include:

- docs changed
- overclaims removed or qualified
- snippets verified
- commands run
- known docs gaps

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/architecture.md`
- [ ] `README.md`
