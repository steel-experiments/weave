# Policy Enforcement Over Requests Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Add runtime policy enforcement over typed tool, gate, and capability request boundaries using the stable authoring model from V1 and the capability contracts from slice 38.

## Non-goals

- Do not build a full external policy service.
- Do not add arbitrary workflow orchestration.
- Do not replace explicit `ctx.gate` approval flows.
- Do not add capability contracts in this slice; depend on slice 38.
- Do not rewrite tool execution or credential resolution around Effect.

## User Outcome

As an operator, I can configure policy rules that approve, deny, or require gates for sensitive actions before tools or capability-backed requests execute.

## Architecture Impact

- Extends app or runtime definitions with policy enforcement configuration.
- Connects approval policies, gates, tool requests, and capability declarations.
- May add policy evaluation events or enrich existing gate/failure events if durable audit evidence requires it.
- Must preserve replay determinism: policy decisions that affect agent flow need durable evidence.
- Builds on typed events and stable IDs from slice 37 and capability contracts from slice 38.

## Implementation Plan

1. Define the smallest policy evaluation boundary for V1 enforcement.
2. Decide whether enforcement happens during `ctx.tool`, tool worker execution, or both.
3. Define durable audit evidence for allow, deny, and require-approval outcomes.
4. Integrate existing `approvalPolicy` helpers with enforcement where appropriate.
5. Add gate creation behavior for require-approval outcomes.
6. Add denial behavior with durable failure or policy event semantics.
7. Add tests for allow, deny, require-gate, replay, and idempotency.
8. Update docs and examples only where they clarify the enforcement model.

## Test Plan

- Policy allow test: tool proceeds without extra gate.
- Policy require-gate test: tool request or capability request blocks until approval.
- Policy deny test: request does not execute and durable evidence is recorded.
- Replay test: repeated runs do not duplicate policy/gate events.
- Mismatch test: changed policy-relevant input is caught or documented according to chosen semantics.
- Tool worker integration test if enforcement occurs at worker boundary.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Policy enforcement boundary is documented and tested.
- [x] Policies can allow, deny, or require approval for supported request types.
- [x] Require-approval outcomes integrate with gates.
- [x] Denied outcomes record durable evidence and prevent execution.
- [x] Replay does not duplicate policy or gate events.
- [x] Capability declarations from slice 38 are usable in policy decisions.
- [x] Docs distinguish policy helpers from runtime enforcement.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Define enforcement boundary.
- [x] Implement policy decision model.
- [x] Integrate gates and failures.
- [x] Add tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Final enforcement boundary is `ctx.tool` planning. Policies are evaluated before `tool.requested` is recorded and before workers can execute.
- Added `policy(...)` and `definePolicy(...)` runtime request rule helpers plus app-level `policies` registration.
- Added `policy.evaluated` durable audit events with `allowed`, `denied`, and `approval_required` outcomes.
- `allow` records policy evidence and then `tool.requested`.
- `deny` records policy evidence plus `agent.failed` and does not record `tool.requested`.
- `approval_required` records policy evidence plus `gate.created`; after `gate.resolved: approved`, replay records `tool.requested`; after denial, replay records `agent.failed`.
- Replay uses recorded `policy.evaluated` decisions instead of re-running current policy code. Policy-relevant request mismatch raises `ReplayMismatchError`.
- Capability declarations are available to policy rules through `request.capabilities`.
- Existing tool requests without policy evidence remain compatible and are not retroactively blocked.
- Tests added for allow, deny, approval required, approval denial, replay idempotency, capability-aware policy decisions, input mismatch, public exports, and app registration.
- Docs updated in `docs/declarative-api.md`, `docs/event-taxonomy.md`, `docs/architecture.md`, and `docs/glossary.md`.
- Verified with `npm test` and `npm run typecheck`.
- Limitations: worker-side re-evaluation, external policy services, policy over raw `ctx.gate`, and richer capability scope validation remain follow-up work.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md` if events change
- [x] `docs/architecture.md`
- [x] `docs/glossary.md`
