# Docs Sync Slice 6: Model-backed Review Boundary

## Status

- Vertical: docs-sync
- Status: In Progress
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Introduce non-deterministic expert review behind an async typed tool boundary while keeping the planner deterministic and replayable from thread events.

## User Outcome

Docs sync can use a model for expert judgment without hiding model calls inside the runner or accepting unvalidated model output as durable findings.

## Current Progress

Implemented:

- async review boundary exists as a tool
- output is schema-validated before findings are appended
- model review consumes compact audit summaries and artifact references, not raw large bodies
- model review runs through normal `tool.requested` / `tool.completed` lifecycle events

Still open:

- replace deterministic stub reviewer with real model provider integration
- document provider metadata, redaction, timeout, and retry behavior
- add provider-specific tests around invalid model output and provider failures

## Architecture Impact

This slice reinforces a reusable boundary:

- planner stays deterministic and event-driven
- model call is a tool execution
- model output is schema-validated
- model failure is `tool.failed`, not runner crash
- model prompts use compact summaries and excerpts, not full raw docs bodies

## Test Plan

- Stub model tool returns valid findings and they are appended only after schema validation.
- Invalid model output becomes `tool.failed` and does not append findings.
- Provider timeout becomes `tool.failed` with retry-safe metadata.
- Prompt construction excludes raw large bodies and secrets.
- Replay does not require in-memory model state.

## Acceptance Criteria

- [x] Model failures appear as `tool.failed`, not runner crashes for the tool boundary.
- [x] Model output is schema-validated before becoming agent findings.
- [x] Replay does not require hidden in-memory model state.
- [ ] Real model provider integration exists behind the same contract.
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Partially shipped and aligned with current tool-boundary architecture. This slice remains `In Progress` until a real provider is integrated or the product explicitly accepts deterministic-only review.

Implemented modules:

- `examples/steel-docs-sync/src/tools.ts`: defines `steelModelReviewTool`, `SteelDocsModelReviewInputSchema`, and `SteelDocsModelReviewDataSchema`.
- `examples/steel-docs-sync/src/agent.ts`: requests `steel.modelReview` through `ctx.tool("model-review", ...)` and emits findings only after typed output is returned.
- `src/tool-worker.ts`: validates tool outputs before appending `tool.completed`; invalid model output would fail at the tool boundary.

Architecture alignment:

- Model review is a tool, not hidden runner work.
- The runner remains replay-only and deterministic over thread events.
- The current deterministic provider is a stand-in behind the same typed contract a real provider should use.

Test evidence:

- `examples/steel-docs-sync/src/index.ts` and `webhook-demo.ts` assert `steel.modelReview` is requested after `steel.auditDocsSync`.
- Generic tool-worker tests in `src/tests/replay-authoring.test.ts` cover output schema validation and `tool.failed` behavior.

Commands run during this review:

- `npm test`
- `npm run typecheck`

## Docs To Update On Completion

- [ ] `../../declarative-api.md` if model tool credentials or observability change
- [x] `../../steel-docs-sync-example.md` for review behavior
- [x] this slice with exact implementation evidence
