# Root Session Idempotency Mismatch Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Prevent `ThreadService.startSession` from silently reusing an idempotent root session when the retry payload changed.

## Non-goals

- Do not change deterministic thread id generation.
- Do not add app-aware agent validation.
- Do not handle child session idempotency mismatches in this slice.
- Do not add persisted request hashes.

## User Outcome

As an API caller, if I reuse an idempotency key with different root session input, Weave reports a replay/idempotency mismatch instead of returning an unrelated existing thread.

## Architecture Impact

- `ThreadService.startSession` compares existing `session.started` and `prompt.received` payloads to the new idempotent request.
- Mismatches throw `ReplayMismatchError`.
- Matching idempotent retries keep returning the existing `{ threadId, correlationId }`.

## Implementation Plan

1. Preserve existing idempotent success behavior for identical retries.
2. Compare prompt, source, agentName, and metadata when an idempotent session already exists.
3. Throw `ReplayMismatchError` when the retry differs.
4. Add regression tests for matching and mismatched retries.
5. Update public docs and slice index.

## Test Plan

- Matching idempotent root session retry returns the same session.
- Reusing the key with a different prompt throws `ReplayMismatchError`.
- Reusing the key with a different `agentName` throws `ReplayMismatchError`.
- Run existing replay tests and typecheck.

## Acceptance Criteria

- [x] Identical root session idempotency retries keep working.
- [x] Prompt mismatches are rejected.
- [x] Agent-name mismatches are rejected.
- [x] Metadata/source mismatches are rejected.
- [x] Existing replay tests and demos still pass.

## Progress

- [x] Add mismatch detection.
- [x] Add regression tests.
- [x] Run verification.

## Completion Notes

Shipped behavior:

- `ThreadService.startSession` validates idempotent retries against existing `session.started` and `prompt.received` events.
- Matching retries return the existing `{ threadId, correlationId }`.
- Changed `prompt`, `source`, `agentName`, or `metadata` throws `ReplayMismatchError`.
- Public retry return shape remains limited to `{ threadId, correlationId }`.

Changed modules:

- `src/thread-service.ts`: adds root session idempotency mismatch detection.
- `src/tests/replay-authoring.test.ts`: adds matching and mismatched retry coverage.
- `docs/declarative-api.md`: documents root session idempotency mismatch semantics.

Commands run:

- `npm test`
- `npm run typecheck`

Known gaps:

- Child session idempotency mismatch detection remains a follow-up slice.
- There is no persisted request hash; comparison uses the existing start events.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
