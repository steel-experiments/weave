# Docs Sync Slice 8: Worker Reliability And Diagnostics

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Make webhook-triggered, network-heavy docs audits reliable enough to operate with visible retries, bounded failures, dead-letter behavior, and diagnostics.

## User Outcome

Operators can inspect why a docs sync thread is waiting, retrying, dead-lettered, failed, or completed with audit findings.

## Current Progress

Implemented according to the rollup:

- bounded retries
- dead-letter inbox state
- inbox diagnostics
- fetch timeouts
- content-size limits

Now implemented:

- bounded tool retries for `RetryableToolError`
- dead-letter inbox state for terminal tool failures
- inbox diagnostics endpoint
- fetch timeouts and content-size limits in the Steel audit tool
- SSE summary/completion stream for webhook-triggered runs

Still open as follow-up work:

- configurable retry policy
- broader operator UI beyond JSON diagnostics and SSE

## Architecture Impact

This slice affects reusable worker and inbox behavior.

Important distinction:

- audit findings are product results
- worker failures are infrastructure or execution failures

These should not collapse into one ambiguous failed state.

## Test Plan

- Transient tool failure retries up to the configured limit.
- Exhausted retry attempts mark work dead-lettered and visible in diagnostics.
- Fetch timeout produces a bounded failure with no hanging worker.
- Content-size limit prevents large payloads from entering events.
- Permanent audit findings do not appear as worker infrastructure failures.
- Diagnostics endpoint or view exposes pending, claimed, done, failed, and dead-letter work with attempt counts.

## Acceptance Criteria

- [x] Transient network failures are visible and bounded.
- [x] Permanent audit findings do not look like worker infrastructure failures.
- [x] Operators can inspect why a webhook-triggered thread stopped.
- [x] Retry and dead-letter policy is tuned and documented.
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Shipped and aligned with current worker/inbox architecture.

Implemented modules:

- `src/tool-worker.ts`: retries `RetryableToolError` up to three attempts, emits retry progress, appends `tool.failed` for terminal execution failures, and returns error metadata for dead-lettering.
- `src/postgres-engine.ts`: supports `dead-letter` inbox state and `listInbox` diagnostics.
- `src/api-server.ts`: exposes `GET /threads/:id/diagnostics/inbox` and SSE stream summaries.
- `examples/steel-docs-sync/src/tools.ts`: uses bounded fetch timeouts, converts transient network failures to `RetryableToolError`, and enforces response size limits.
- `examples/steel-docs-sync/src/webhook-demo.ts`: covers retry success, terminal failure, dead-letter diagnostics, and no lingering claimed inbox rows.

Architecture alignment:

- Worker reliability is generic Weave runtime behavior, not docs-sync-only retry logic.
- Audit findings remain successful product results; infrastructure/tool execution failures become `tool.failed` and failed thread summaries.
- Diagnostics are read from inbox state, not inferred from arbitrary event scans.

Test evidence:

- Flaky `llms.txt` fixture returns transient `503` twice and then succeeds; `webhook-demo.ts` asserts retry progress events and completed thread status.
- Missing `llms.txt` fixture produces failed summary with `execution_failed` and a dead-letter inbox item.
- `webhook-demo.ts` asserts no inbox item remains `claimed` after terminal failure.

Commands run during this review:

- `npm test`
- `npm run typecheck`

Known gaps:

- Retry count is fixed in code rather than externally configurable.
- Operator surfaces are currently HTTP JSON/SSE endpoints, not a dashboard.

## Docs To Update On Completion

- [x] `../../runnable-inbox.md`
- [x] `../../architecture.md` if worker reliability semantics changed
- [x] `../../steel-docs-sync-example.md` if operational behavior changed
- [x] this slice with exact implementation evidence
