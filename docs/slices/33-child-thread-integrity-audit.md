# Child Thread Integrity Audit Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Prove that child threads preserve lineage, ownership, terminal mirroring, listing, join, and cancellation semantics before more features depend on them.

## Non-goals

- Do not add cascading cancellation.
- Do not add a separate `cancelled` thread status.
- Do not add per-agent scheduling policy.
- Do not change child dispatch semantics unless an integrity gap requires it.

## User Outcome

As a parent agent author, I can spawn, inspect, join, and cancel child work without accidentally affecting unrelated threads or duplicating terminal evidence.

## Architecture Impact

- Hardens `ThreadService.startChildSession`, `mirrorChildTerminalEvent`, `cancelChildThread`, and `listChildren`.
- Hardens replay-safe `ctx.spawn`, `ctx.join`, `ctx.children`, and `ctx.cancelChild`.
- Validates projection lineage fields: `parentThreadId`, `rootThreadId`, `parentScopeKey`, and `parentStepKey`.
- No new event shape is expected.

## Implementation Plan

1. Verify spawned children persist parent, root, scope, and step lineage.
2. Verify `ctx.join` and terminal mirroring reject unrelated child threads.
3. Verify detached children retain lineage but do not block parent completion.
4. Verify attached child cancellation records durable child failure and parent mirror events.
5. Verify repeated cancellation and repeated terminal mirroring are idempotent where intended.
6. Verify filtering by agent name and status still works after terminal transitions.
7. Document child-thread integrity rules and known gaps.

## Test Plan

- Lineage test for child sessions from root and nested parents.
- Unrelated-child join and mirror rejection test.
- Detached child test proving parent can complete while child remains nonterminal.
- Cancellation tests for existing, already terminal, repeated, and unrelated child cases.
- Terminal mirroring idempotency test proving `child_thread.completed` or `child_thread.failed` is appended once.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Spawned child projections contain correct parent and root lineage.
- [ ] Parent scope and step keys identify the parent durable spawn effect.
- [ ] Parents cannot join or mirror unrelated child threads.
- [ ] Detached children retain lineage and do not block parent completion.
- [ ] Cancellation rejects unrelated children and handles repeated requests safely.
- [ ] Child terminal mirroring is idempotent.
- [ ] Child listing filters still work after status changes.

## Progress

- [ ] Inventory existing child-thread coverage.
- [ ] Add missing lineage and ownership tests.
- [ ] Add missing detached and cancellation tests.
- [ ] Add mirroring idempotency tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- integrity behavior proven
- tests added or confirmed existing
- commands run
- known child-thread limitations

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md`
