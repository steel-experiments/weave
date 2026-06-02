# V1 Authoring API Stabilization Slice

## Status

- Vertical: `weave-core`
- Status: `In Progress`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Stabilize the run-first authoring and runtime boundary so `api-refactor` can merge safely and become the new baseline.

## Non-goals

- Do not add the full capabilities model.
- Do not add a full policy engine beyond existing approval policy helpers.
- Do not rewrite runtime internals around Effect.
- Do not add workflow, cluster, or external integration features.
- Do not add more demos before the existing examples are hardened.

## User Outcome

As a Weave app author, I can adopt the new V1 authoring model with clear public imports, predictable replay semantics, documented limitations, and confidence that existing data and examples still work.

## Architecture Impact

- No new public primitive is expected from this umbrella slice.
- Locks down the intended package boundary across `weave`, `weave/runtime`, `weave/postgres`, `weave/server`, and `weave/testing`.
- Adds compatibility and invariant tests around the event log, replay runtime, child threads, and examples.
- Produces upgrade documentation for planner-first and legacy tool-output users.

## Implementation Plan

1. Ship the public API export audit slice.
2. Ship the migration and legacy compatibility slice.
3. Ship the replay invariant hardening slice.
4. Ship the child-thread integrity audit slice.
5. Ship the documentation conformance slice.
6. Ship the example quality audit slice.
7. Ship the upgrade guide slice.
8. Run the merge gate commands and capture completion notes.

## Test Plan

- Run `npm test` for replay and runtime invariants.
- Run `npm run typecheck` across the root package and all workspaces.
- Add public API smoke coverage for root and subpath exports.
- Add compatibility coverage for legacy and new event shapes.
- Add or verify child-thread integrity tests.
- Run example-specific smoke commands where they do not require external credentials.

## Acceptance Criteria

- [x] Public package exports are tested and documented.
- [x] Legacy event and tool-output compatibility is tested.
- [x] Replay invariants are captured as regression tests.
- [x] Child-thread lineage, ownership, cancellation, and terminal mirroring are covered.
- [x] Docs accurately describe implemented V1 behavior and limitations.
- [ ] Examples have clear roles and remain trustworthy.
- [ ] Upgrade guidance exists for authors moving from planner-first and enveloped tool outputs.
- [ ] `npm test` and `npm run typecheck` pass after all stabilization changes.

## Progress

- [x] `30-public-api-export-audit.md`
- [ ] `31-migration-legacy-compatibility.md`
- [x] `32-replay-invariant-hardening.md`
- [x] `33-child-thread-integrity-audit.md`
- [x] `34-documentation-conformance-pass.md`
- [ ] `35-example-quality-audit.md`
- [ ] `36-api-refactor-upgrade-guide.md`

## Completion Notes

Fill this in when the stabilization milestone ships.

Include:

- shipped test coverage
- public API decisions
- migration compatibility results
- docs updated
- examples verified
- commands run
- known remaining limitations

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md`
- [ ] `docs/architecture.md`
- [ ] `docs/migration/api-refactor.md` or `docs/upgrade-guide.md`
