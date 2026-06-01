# Tool Output Migration Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Let tools return domain-shaped outputs directly while preserving legacy `ToolCompletionOutput` compatibility.

## Non-goals

- Do not remove legacy tool output support.
- Do not implement first-class gates or approval policies.
- Do not migrate the SRE demo tools away from legacy output envelopes yet.

## User Outcome

As a Weave app author, I can define a tool whose output schema describes the real domain object I want from `ctx.tool`, instead of wrapping it in `{ summary, requiresManualApproval, data }`.

## Architecture Impact

- Tool contracts now accept arbitrary typed outputs.
- `tool.completed.payload.output` stores canonical raw output.
- `tool.completed.payload.summary` stores optional display metadata.
- Legacy `ToolCompletionOutput` remains supported, but `requiresManualApproval` is compatibility-only and not the future approval model.
- Steel docs sync now uses domain-shaped tool outputs.

## Implementation Plan

1. Relax `ToolContract` and `AgentContext.tool` generics to arbitrary `Output`.
2. Add `summarize?(output)` to tool contracts.
3. Change `tool.completed` event schema to `output: unknown` plus optional `summary`.
4. In `ContractToolWorker`, store raw output and compute display summary from `tool.summarize(output)`.
5. Fall back to `output.summary` only when the raw output is legacy-shaped.
6. Keep legacy `requiresManualApproval` inside legacy raw output only.
7. Migrate Steel docs sync tools and agent to domain-shaped outputs.
8. Keep SRE legacy tools working.

## Test Plan

- Run typecheck across root and examples.
- Run replay authoring tests.
- Run Steel docs sync demo to prove domain outputs replay and summarize correctly.
- Run Steel webhook demo to prove failure and artifact paths still work.
- Run SRE demo to prove legacy outputs and manual-approval compatibility still work.

## Acceptance Criteria

- [x] New tools can return domain-shaped outputs directly.
- [x] `ctx.tool` returns the raw typed output.
- [x] `tool.completed.payload.output` stores canonical raw output.
- [x] `tool.completed.payload.summary` stores optional display metadata.
- [x] `output.summary` is used only for legacy-shaped outputs.
- [x] `requiresManualApproval` remains legacy compatibility only.
- [x] Steel docs sync tools use domain-shaped outputs.
- [x] SRE legacy tools still work.

## Progress

- [x] Relax tool output generics.
- [x] Add tool summarizer hook.
- [x] Update event schema.
- [x] Update worker completion event construction.
- [x] Migrate Steel docs sync.
- [x] Preserve SRE legacy behavior.
- [x] Run verification.

## Completion Notes

Changed modules:

- `src/tool-contract.ts`: arbitrary outputs, `summarize`, and legacy output detection.
- `src/events.ts`: raw `tool.completed.payload.output` plus optional `summary`.
- `src/tool-worker.ts`: raw output persistence and summary extraction.
- `src/agent-contract.ts` / `src/agent-runner.ts`: arbitrary `ctx.tool` output typing.
- `src/mock-agent.ts` / `src/mock-tool-worker.ts`: legacy output compatibility.
- `examples/steel-docs-sync/src/tools.ts`: domain-shaped outputs and summarizers.
- `examples/steel-docs-sync/src/agent.ts`: direct use of raw typed outputs.
- `examples/steel-docs-sync/src/index.ts` and `webhook-demo.ts`: raw output assertions.
- `examples/sre-demo/src/index.ts`: summary display from metadata with legacy fallback.
- `docs/declarative-api.md`: updated authoring guide.

Commands run:

- `npm test`
- `npm run typecheck`
- `npm run steel:demo`
- `npm run steel:webhook-demo`
- `npm run sre:demo`

Known gaps:

- SRE tools still use the legacy output envelope and can be migrated later.
- First-class gates and policies are still needed before removing approval semantics from legacy tool outputs.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/interface.md`
