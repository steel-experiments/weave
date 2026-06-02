# Policy Enforcement Over Requests Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
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

- [ ] Policy enforcement boundary is documented and tested.
- [ ] Policies can allow, deny, or require approval for supported request types.
- [ ] Require-approval outcomes integrate with gates.
- [ ] Denied outcomes record durable evidence and prevent execution.
- [ ] Replay does not duplicate policy or gate events.
- [ ] Capability declarations from slice 38 are usable in policy decisions.
- [ ] Docs distinguish policy helpers from runtime enforcement.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Define enforcement boundary.
- [ ] Implement policy decision model.
- [ ] Integrate gates and failures.
- [ ] Add tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- final enforcement boundary
- durable audit event behavior
- tests added
- docs updated
- commands run
- policy limitations and follow-up slices

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/event-taxonomy.md` if events change
- [ ] `docs/architecture.md`
- [ ] `docs/glossary.md`
