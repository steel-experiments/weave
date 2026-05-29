# Docs Sync Slice 3: Session Metadata And Idempotency

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-05-29
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Persist GitHub run metadata, source URLs, audit mode, actor identity, and idempotency information when a docs sync thread starts.

## User Outcome

Operators can inspect a thread and understand which GitHub run, commit, mode, and source URLs started it. Duplicate webhook deliveries are safe.

## Architecture Impact

This slice affects reusable session creation semantics.

Expected API shape:

- `ThreadService.startSession` accepts structured input, not only a prompt string
- `session.started` or adjacent metadata records source and integration context
- idempotency keys are accepted for webhook-triggered starts
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
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

The original rollup marks this slice complete. This document still needs code-path and test-evidence backfill.

## Docs To Update On Completion

- [ ] `../../event-taxonomy.md` if `session.started` shape changed
- [ ] `../../interface.md` if `ThreadService` shape changed
- [ ] this slice with exact implementation evidence
