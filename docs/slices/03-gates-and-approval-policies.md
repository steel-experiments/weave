# Gates And Approval Policies Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Make approval gates a first-class replay-safe `agent.run` durable effect instead of encoding approval intent in tool outputs.

## Non-goals

- Do not build a centralized policy engine yet.
- Do not remove legacy `ToolCompletionOutput.requiresManualApproval` compatibility.
- Do not remove lower-level planner support for manual `gate.created` events.

## User Outcome

As a Weave app author, I can write `await ctx.gate("approve-remediation", request)` and branch on the returned approval resolution after the gate is resolved.

## Architecture Impact

- Adds `ctx.gate(key, request)` to `AgentContext`.
- Uses existing `gate.created` and `gate.resolved` events.
- Durable identity is `threadId + scopeKey + stepKey`.
- `gateId` is deterministic from the durable identity and remains the external resolution identity.
- `ThreadService.resolveGate` propagates `scopeKey` and `stepKey` onto `gate.resolved` events.
- SRE tools no longer advertise approval metadata on the tool contract; the SRE agent remains responsible for creating the remediation gate.

## Implementation Plan

1. Add `GateRequest` and `GateResolution` types to `agent-contract`.
2. Add `ctx.gate` to the replay context.
3. Missing gate: append `gate.created` and suspend.
4. Pending gate: append nothing and suspend.
5. Resolved gate: return `gate.resolved.payload`.
6. Mismatched key/type/payload: throw `ReplayMismatchError`.
7. Add replay tests for create, pending, resolved, and mismatch paths.
8. Remove SRE tool-level gate metadata.
9. Update docs.

## Acceptance Criteria

- [x] Agents can create gates from `agent.run` using stable step keys.
- [x] Existing unresolved gates suspend without duplicate creation.
- [x] Resolved gates replay deterministically and return the resolution payload.
- [x] Reusing a gate key with a different durable effect kind throws `ReplayMismatchError`.
- [x] Changing a gate payload for an existing key throws `ReplayMismatchError`.
- [x] External gate resolution still uses `ThreadService.resolveGate`.
- [x] SRE approval is represented as agent-created gate flow, not tool-level approval metadata.

## Completion Notes

Changed modules:

- `src/agent-contract.ts`: `GateRequest`, `GateResolution`, and `AgentContext.gate`.
- `src/agent-runner.ts`: replay-safe gate creation, pending suspension, resolution replay, and mismatch checks.
- `src/thread-service.ts`: propagates durable identity onto `gate.resolved` events.
- `src/tests/replay-authoring.test.ts`: gate replay and mismatch coverage.
- `examples/sre-demo/src/tools.ts`: removes tool-level gate metadata from `infra.rebuildNode`.
- `docs/declarative-api.md`: documents `ctx.gate`.

Known follow-ups:

- Runtime-enforced policy decisions beyond the authoring helper added in `08-policy-helpers-for-gates.md`.
- Gate schemas beyond manual approval.
- SRE migration from legacy tool output envelopes to domain-shaped outputs was completed by `04-sre-run-first-domain-outputs.md`.
