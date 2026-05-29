# Docs Sync Slice 8: Worker Reliability And Diagnostics

## Status

- Vertical: docs-sync
- Status: In Progress
- Last updated: 2026-05-29
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

Still open:

- policy tuning
- broader operator surfaces
- completion notes and test evidence backfill

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
- [ ] Retry and dead-letter policy is tuned and documented.
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Partially shipped. This slice remains open for policy tuning, operator surfaces, and evidence backfill.

## Docs To Update On Completion

- [ ] `../../runnable-inbox.md`
- [ ] `../../architecture.md` if worker reliability semantics changed
- [ ] `../../steel-docs-sync-example.md` if operational behavior changed
- [ ] this slice with exact implementation evidence
