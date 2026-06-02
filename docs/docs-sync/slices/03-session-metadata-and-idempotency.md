# Docs Sync Slice 3: Session Metadata And Idempotency

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Persist GitHub run metadata, source URLs, audit mode, actor identity, and idempotency information when a docs sync thread starts.

## User Outcome

Operators can inspect a thread and understand which GitHub run, commit, mode, and source URLs started it. Duplicate webhook deliveries are safe.

## Architecture Impact

This slice affects reusable session creation semantics.

Expected API shape:

- `ThreadService.startSession` accepts structured input, not only a prompt string
- `session.started` metadata records source and integration context
- idempotency keys are accepted for webhook-triggered starts
- changed root session inputs for a reused idempotency key are rejected by the current core mismatch semantics
- metadata excludes secrets

## Test Plan

- Starting a session with metadata persists that metadata in durable events.
- Starting a session with an idempotency key is safe under duplicate calls.
- Duplicate GitHub Action deliveries return the same thread or produce a harmless no-op according to the implemented policy.
- Secret-looking values are not stored in metadata.
- Existing PoC scripts still work or are migrated to the new API.

## Acceptance Criteria

- [x] Existing PoC scripts still work or were migrated.
- [x] Webhook metadata is durable in the event stream.
- [x] Duplicate GitHub Action deliveries are safe.
- [x] No secret values are stored in metadata.
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Shipped and aligned with the current Weave architecture.

Implemented modules:

- `examples/steel-docs-sync/src/server.ts`: passes webhook payload metadata, `source: "github-action"`, actor identity, and deterministic idempotency key into `ThreadService.startSession`.
- `src/thread-service.ts`: stores root session metadata in `session.started.payload.metadata`, supports deterministic idempotency, and rejects mismatched idempotent retries with `ReplayMismatchError`.
- `examples/steel-docs-sync/src/webhook-demo.ts`: asserts webhook metadata is durable and duplicate deliveries return the same thread id.

Architecture alignment:

- Uses current root session metadata and idempotency semantics from Weave core slices 24 and 26.
- Does not store webhook secrets in events; only signed payload metadata is persisted.
- Duplicate deliveries reuse the existing thread instead of duplicating reviews.

Test evidence:

- `webhook-demo.ts` asserts `session.started.payload.source === "github-action"` and `session.started.payload.metadata` equals the webhook payload.
- `webhook-demo.ts` posts a duplicate payload and asserts the same `threadId` is returned.
- Core replay tests cover idempotency mismatch rejection for changed root session input.

Commands run during this review:

- `npm test`
- `npm run typecheck`

## Docs To Update On Completion

- [x] `../../event-taxonomy.md` if `session.started` shape changed
- [x] `../../interface.md` if `ThreadService` shape changed
- [x] this slice with exact implementation evidence
