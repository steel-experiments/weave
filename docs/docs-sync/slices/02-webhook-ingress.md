# Docs Sync Slice 2: Webhook Ingress

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-05-29
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
- thread creation through `ThreadService`
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
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

The original rollup marks this slice complete. This document still needs code-path and test-evidence backfill.

## Docs To Update On Completion

- [ ] `../../steel-docs-sync-example.md` if payload shape changed
- [ ] this slice with exact implementation evidence
