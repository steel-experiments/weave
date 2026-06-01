# SRE Run-First Domain Outputs Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Migrate the SRE north-star demo onto the new developer-facing authoring surface: `agent.run`, domain-shaped tool outputs, `ctx.emit`, and `ctx.gate`.

## Non-goals

- Do not remove legacy `ToolCompletionOutput` compatibility from core.
- Do not remove planner-first support.
- Do not build reusable approval policy helpers yet.

## User Outcome

As a Weave app author, I can read the SRE example as the reference for a gate-heavy durable agent written as ordinary async TypeScript.

## Architecture Impact

- SRE tools now return domain objects directly.
- Tool summaries are produced by `tool.summarize(output)`.
- The SRE agent is now `defineAgent({ async run(ctx, input) { ... } })`.
- SRE investigation tool calls use `ctx.tool` with stable step keys.
- Findings, remediation proposals, incident reports, and final responses use `ctx.emit`.
- Risky remediation approval uses `ctx.gate`.
- The demo asserts completed SRE tool outputs are not legacy envelopes.

## Implementation Plan

1. Convert SRE tool output schemas from legacy envelopes to domain objects.
2. Add `summarize(output)` to every SRE tool.
3. Replace the deterministic planner with a run-first SRE agent.
4. Preserve the event story: investigation tools, finding, remediation proposal, gate, approved rebuild, incident report, final response.
5. Update demo assertions to prove domain-shaped outputs.
6. Keep mock legacy code paths untouched.

## Acceptance Criteria

- [x] SRE demo uses `agent.run`, not a custom planner.
- [x] SRE tools no longer return `summary`, `requiresManualApproval`, or `data` envelopes.
- [x] SRE completed tool events still include optional display summaries.
- [x] SRE approval is expressed through `ctx.gate`.
- [x] SRE emits structured finding, remediation, report, and response events through `ctx.emit`.
- [x] The SRE demo still completes after approval and runs the remediation tool.
- [x] Steel demos and replay tests still pass.

## Completion Notes

Changed modules:

- `examples/sre-demo/src/tools.ts`: domain-shaped output schemas and summarizers.
- `examples/sre-demo/src/agent.ts`: run-first agent using `ctx.tool`, `ctx.emit`, and `ctx.gate`.
- `examples/sre-demo/src/app.ts`: imports the run-first SRE agent.
- `examples/sre-demo/src/index.ts`: asserts domain-shaped SRE tool outputs.

Commands run:

- `npm test`
- `npm --workspace weave-sre-demo run typecheck`
- `npm run sre:demo`

Full final verification also ran the root typecheck and Steel demos.

Known follow-ups:

- Keep legacy mock agent/tool compatibility until a deliberate removal slice.
- Add reusable policy helpers for approval rules.
