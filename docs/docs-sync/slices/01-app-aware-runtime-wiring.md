# Docs Sync Slice 1: App-aware Runtime Wiring

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-05-29
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Allow a Weave app to boot with custom agents, tools, credentials, observability, runner daemon, and tool daemon without copying the SRE demo wiring every time.

## User Outcome

Docs sync can run as its own Weave app rather than a standalone script that bypasses the thread primitive.

## Architecture Impact

This slice belongs in reusable Weave runtime support, not docs-sync-only code.

Expected reusable concepts:

- `defineWeaveApp`
- active agent selection
- `ThreadRunner`
- `ContractToolWorker`
- app credential provider
- app observability sink
- route extension or app-owned HTTP server pattern

## Test Plan

Tests should prove the real runtime wiring works.

- Construct a test app with a deterministic agent and typed tool.
- Boot runner and tool worker through the runtime helper or app wiring path.
- Start a thread and verify the custom tool, not the mock default, executes.
- Verify credentials and observability sinks are passed to workers without storing secrets in events.
- Avoid tests that mock the whole runtime helper.

## Acceptance Criteria

- [x] Example apps can boot app-specific agents and tools.
- [x] Core generic scripts remain simple.
- [x] Docs sync no longer needs to duplicate all daemon setup.
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

The original rollup marks this slice complete. This document still needs code-path and test-evidence backfill.

## Docs To Update On Completion

- [ ] `../../declarative-api.md` if app authoring changed
- [ ] `../../architecture.md` if runtime boundaries changed
- [ ] this slice with exact implementation evidence
