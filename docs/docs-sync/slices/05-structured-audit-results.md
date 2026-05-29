# Docs Sync Slice 5: Structured Audit Results

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-05-29
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Expose stable audit outcome and finding summaries so CI and humans do not need to deeply parse every event.

## User Outcome

GitHub Actions can decide pass, warning, or failure from a stable API or event shape, while humans can inspect detailed evidence in the full event history.

## Architecture Impact

This slice should start with generic finding semantics rather than docs-specific event types.

Expected behavior:

- use `agent.finding.produced` or structured tool output for docs findings
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
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

The original rollup marks this slice complete. This document still needs code-path and test-evidence backfill.

## Docs To Update On Completion

- [ ] `../../event-taxonomy.md` if finding events changed
- [ ] `../../steel-docs-sync-example.md` if summary shape changed
- [ ] this slice with exact implementation evidence
