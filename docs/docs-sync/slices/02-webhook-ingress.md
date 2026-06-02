# Docs Sync Slice 2: Webhook Ingress

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Let GitHub Actions start a docs sync audit through an authenticated webhook while preserving thread-created durable history.

## User Outcome

A valid signed GitHub Actions payload creates one runnable Weave thread and returns status and event URLs.

## Architecture Impact

This slice is app-level ingress. It should not add docs-specific behavior to Weave core except reusable session metadata and idempotency support covered by Slice 3.

Important requirements:

- HMAC verification
- stale timestamp rejection
- Zod payload validation
- repository allowlist
- URL host allowlist
- thread creation through `ThreadService.startSession`
- existing inbox wake routing

## Test Plan

- Valid signed payload creates a thread through the real service.
- Invalid signature returns 401 or 403 and creates no thread.
- Stale timestamp returns an error and creates no thread.
- Invalid repository or host returns 400 and creates no thread.
- Duplicate delivery behavior is covered with Slice 3 idempotency tests.
- Tests should mock only HTTP/network boundaries, not payload validation or `ThreadService`.

## Acceptance Criteria

- [x] Invalid signatures are rejected.
- [x] Invalid repository or URL hosts are rejected.
- [x] Valid webhook requests create a thread and return status/events URLs.
- [x] Webhook-created threads wake the runner through existing inbox routing.
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Shipped and aligned with the current Weave architecture.

Implemented modules:

- `examples/steel-docs-sync/src/server.ts`: defines `createSteelDocsSyncApiServer`, HMAC verification, timestamp freshness checks, Zod payload validation, repository allowlist, URL host allowlist, and custom route registration through `createApiServer(..., { beforeRoutes })`.
- `examples/steel-docs-sync/src/webhook-demo.ts`: exercises signed webhook ingress against a real HTTP server, Postgres engine, `ThreadService`, runner daemon, and tool daemon.

Architecture alignment:

- Ingress is app-level server wiring, not a docs-sync-specific core primitive.
- Valid ingress creates durable sessions through `ThreadService.startSession` and wakes the runner via normal `prompt.received` inbox routing.
- Status, event, summary, stream, artifact, and diagnostics URLs are served by reusable Weave API routes.

Test evidence:

- Invalid signatures return `403` without creating a thread.
- Invalid URL hosts return `400`.
- Valid signed payloads return `202` with `threadId`, `statusUrl`, and `eventsUrl`.
- Webhook-created threads complete through the real runtime in `webhook-demo.ts`.

Commands run during this review:

- `npm test`
- `npm run typecheck`

## Docs To Update On Completion

- [x] `../../steel-docs-sync-example.md` if payload shape changed
- [x] this slice with exact implementation evidence
