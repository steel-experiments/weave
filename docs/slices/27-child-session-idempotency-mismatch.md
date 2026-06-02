# Child Session Idempotency Mismatch Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Prevent `ThreadService.startChildSession` from silently reusing an idempotent child session when the retry payload changed.

## Non-goals

- Do not change deterministic child thread id generation.
- Do not add app-aware child agent validation.
- Do not add persisted request hashes.
- Do not add multi-thread append transactions.

## User Outcome

As an API caller or parent agent, if I reuse a child idempotency key with different child work, Weave reports a replay/idempotency mismatch instead of returning an unrelated existing child.

## Architecture Impact

- `ThreadService.startChildSession` compares existing child `session.started` and `prompt.received` payloads to the new idempotent request.
- Child lineage is checked against the requested parent/root/scope/step identity.
- Parent `child_thread.spawned` evidence is checked against child agent, spawn identity, mode, input hash, prompt summary, and metadata.
- Mismatches throw `ReplayMismatchError`.

## Implementation Plan

1. Preserve existing idempotent success behavior for identical retries.
2. Compare child session start events for source, agent name, input, and prompt.
3. Compare child projection lineage for parent/root/scope/step identity.
4. Compare existing parent spawn event for mode, input hash, prompt summary, and metadata.
5. Add regression tests for matching and mismatched retries.

## Test Plan

- Matching idempotent child session retry returns the same child.
- Reusing the key with a different child input throws `ReplayMismatchError`.
- Reusing the key with a different child agent throws `ReplayMismatchError`.
- Reusing the key with a different parent step throws `ReplayMismatchError`.
- Reusing the key with different detached mode or metadata throws `ReplayMismatchError`.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] Identical child session idempotency retries keep working.
- [x] Child input mismatches are rejected.
- [x] Child agent-name mismatches are rejected.
- [x] Parent scope/step mismatches are rejected.
- [x] Detached mode and parent metadata mismatches are rejected.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add mismatch detection.
- [x] Add regression tests.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- `ThreadService.startChildSession` validates idempotent retries against the existing child `session.started` and `prompt.received` events.
- Existing child lineage is checked against the requested parent thread, root thread, parent scope key, and parent step key.
- Existing parent `child_thread.spawned` events are checked against child agent name, spawn scope/step, attached/detached mode, input hash, prompt summary, and parent metadata.
- Changed child work throws `ReplayMismatchError`.

Changed modules:

- `src/thread-service.ts`: adds child session, lineage, and parent spawned-event idempotency mismatch detection.
- `src/tests/replay-authoring.test.ts`: extends child idempotency coverage for input, agent, parent step, detached mode, and metadata mismatches.
- `docs/declarative-api.md`: documents child session idempotency mismatch semantics.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- There is no persisted request hash; comparison uses existing child and parent events.
- Multi-thread append transactions remain future work.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
