# Docs Sync Slice 6: Model-backed Review Boundary

## Status

- Vertical: docs-sync
- Status: In Progress
- Last updated: 2026-05-29
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Introduce non-deterministic expert review behind an async typed tool boundary while keeping the planner deterministic and replayable from thread events.

## User Outcome

Docs sync can use a model for expert judgment without hiding model calls inside the runner or accepting unvalidated model output as durable findings.

## Current Progress

Implemented according to the rollup:

- async review boundary exists as a tool
- output is schema-validated before findings are appended

Still open:

- replace deterministic stub reviewer with real model provider integration
- document provider metadata, redaction, timeout, and retry behavior
- add tests around invalid model output and provider failures

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
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Partially shipped with a deterministic stub reviewer. This slice remains open until a real provider is integrated or the stub-only scope is explicitly accepted.

## Docs To Update On Completion

- [ ] `../../declarative-api.md` if model tool credentials or observability change
- [ ] `../../steel-docs-sync-example.md` for review behavior
- [ ] this slice with exact implementation evidence
