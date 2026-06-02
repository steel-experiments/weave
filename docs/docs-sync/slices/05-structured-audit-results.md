# Docs Sync Slice 5: Structured Audit Results

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Expose stable audit outcome and finding summaries so CI and humans do not need to deeply parse every event.

## User Outcome

GitHub Actions can decide pass, warning, or failure from a stable API or event shape, while humans can inspect detailed evidence in the full event history.

## Architecture Impact

This slice should start with generic finding semantics rather than docs-specific event types.

Expected behavior:

- use `agent.finding.produced` plus structured tool output for docs findings
- expose finding counts by severity
- expose final outcome such as `passed`, `warning`, or `failed`
- keep full evidence inspectable in event history and artifacts

## Test Plan

- Deterministic audit output produces structured findings with severity and evidence.
- Summary endpoint or stable event parser returns counts by severity.
- Critical findings produce failed CI outcome.
- Warning findings produce warning outcome without infrastructure failure.
- Tests assert event and API shape, not only final text.

## Acceptance Criteria

- [x] GitHub Actions can decide pass or fail from a stable API or event shape.
- [x] Humans can inspect full event history for evidence.
- [x] No docs-specific event is added until the generic finding path proves insufficient.
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Shipped and aligned with the current Weave architecture.

Implemented modules:

- `examples/steel-docs-sync/src/tools.ts`: defines `SteelDocsAuditDataSchema` and `SteelDocsModelReviewDataSchema` with stable `outcome`, `findings`, and evidence fields.
- `examples/steel-docs-sync/src/agent.ts`: emits generic `agent.finding.produced` events through typed `event(...)` factories.
- `src/summary.ts`: builds generic `ThreadSummary` with finding counts by severity and CI-readable outcome.
- `src/api-server.ts`: exposes `GET /threads/:id/summary` and SSE `thread.summary` / `thread.completed` events.

Architecture alignment:

- Uses generic event taxonomy (`agent.finding.produced`) instead of docs-specific event types.
- Uses raw typed tool outputs plus `agent.output.completed` from current core architecture.
- CI can read `ThreadSummary.execution` and `ThreadSummary.outcome` without parsing all events.

Test evidence:

- `examples/steel-docs-sync/src/index.ts` asserts warning outcome, succeeded execution, and warning finding counts.
- `examples/steel-docs-sync/src/webhook-demo.ts` asserts summary, streamed summary, completion status, and two `agent.finding.produced` events.

Commands run during this review:

- `npm test`
- `npm run typecheck`

## Docs To Update On Completion

- [x] `../../event-taxonomy.md` if finding events changed
- [x] `../../steel-docs-sync-example.md` if summary shape changed
- [x] this slice with exact implementation evidence
