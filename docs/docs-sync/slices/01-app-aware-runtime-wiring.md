# Docs Sync Slice 1: App-aware Runtime Wiring

## Status

- Vertical: docs-sync
- Status: Shipped
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Allow a Weave app to boot with custom agents, tools, credentials, observability, runner daemon, and tool daemon without copying the SRE demo wiring every time.

## User Outcome

Docs sync can run as its own Weave app rather than a standalone script that bypasses the thread primitive.

## Architecture Impact

This slice belongs in reusable Weave runtime support, not docs-sync-only code.

Expected reusable concepts:

- `weave` / `agent` / `tool` app composition
- active agent selection through `createWeaveRuntime({ app, agentName, ... })`
- `ThreadRunner`
- `ContractToolWorker`
- app credential provider
- app artifact store
- app observability sink
- package subpaths for runtime, storage, and server wiring
- route extension through `beforeRoutes` or integrations

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
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Shipped and aligned with the current Weave architecture.

Implemented modules:

- `examples/steel-docs-sync/src/app.ts`: defines the Steel docs app with `weave({ agents: [steelDocsAgent] })`.
- `examples/steel-docs-sync/src/agent.ts`: defines a run-first `steel-docs` agent using typed `ctx.tool` and `ctx.emit` calls.
- `examples/steel-docs-sync/src/index.ts`: boots `createWeaveRuntime` with app-specific agent, tools, artifact store, runner daemon, and tool daemon.
- `examples/steel-docs-sync/src/webhook-demo.ts`: boots the same runtime through the webhook server path.

Architecture alignment:

- Uses root `weave` for authoring and `weave/runtime`, `weave/postgres`, and `weave/server` package subpaths for runtime/storage/server concerns.
- Uses app-scoped tools collected by `createWeaveRuntime`, not a docs-sync-specific runner.
- Uses current run-first replay architecture instead of planner-first event construction.

Test evidence:

- `examples/steel-docs-sync/src/index.ts` asserts tool requests for `steel.auditDocsSync` and `steel.modelReview`, stable step keys, completed projection, summary outcome, and artifact references.
- `examples/steel-docs-sync/src/webhook-demo.ts` exercises the app-specific runtime through signed webhook ingress.

Commands run during this review:

- `npm test`
- `npm run typecheck`

## Docs To Update On Completion

- [x] `../../declarative-api.md` if app authoring changed
- [x] `../../architecture.md` if runtime boundaries changed
- [x] this slice with exact implementation evidence
