# Policy Capability Runtime Stabilization Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Harden policy enforcement as a durable, replay-safe control-plane primitive before adding capability-mediated credentials.

This slice stabilizes the exact runtime semantics around `policy.evaluated`, approval-required policy gates, capability-aware request identity, replay, policy code changes, legacy events, and multi-policy ordering.

## Non-goals

- Do not add capability-mediated credentials.
- Do not add runtime capability grants.
- Do not enforce policies over `ctx.spawn`, `ctx.emit`, or raw `ctx.gate` calls.
- Do not add a full external policy service.
- Do not add policy aggregation, priority graphs, or multiple approval composition.
- Do not add redaction enforcement.
- Do not expand Effect internals.

## User Outcome

As an operator, I can rely on policy decisions as durable facts: policy changes affect new requests, while already-recorded in-flight decisions replay safely without duplicate gates, unexpected denials, or unsafe request reuse.

## Architecture Impact

- Clarifies that `policy.evaluated` is both audit evidence and a durable control decision.
- Changes policy evaluation from a single resolved decision event to ordered per-policy decision evidence if needed for auditability.
- Adds optional `policy.version` metadata and records `policyVersion` in `policy.evaluated`.
- Adds a policy request hash that includes tool request identity, input, capabilities, and relevant options.
- Hardens approval-required gate identity so the same request and policy decision always derive the same gate.
- Documents deterministic `app.policies` ordering and short-circuit behavior.
- Preserves legacy tool requests that do not have policy evidence.

## Proposed Decisions

1. `policy.evaluated` is a durable control decision.
2. Replay uses recorded `policy.evaluated` decisions for matching durable requests and does not re-run policy code.
3. New policy code and versions affect new evaluations, not already-recorded in-flight decisions.
4. Policy decisions are keyed by request identity and request hash.
5. Capability declarations participate in policy request hashing.
6. Policies execute in `app.policies` order.
7. `allow` records the policy decision and continues to the next policy.
8. `deny` records the policy decision, appends `agent.failed`, and stops.
9. `approval_required` records the policy decision, creates or reuses a stable policy gate, and stops.
10. Policy version mismatch does not fail replay by default.

## Proposed `policy.evaluated` Payload

```ts
{
  policyEvaluationId: string;
  policyName: string;
  policyVersion?: string;
  requestKind: "tool.requested";
  requestHash: string;
  outcome: "allowed" | "denied" | "approval_required";
  scopeKey: string;
  stepKey: string;
  policyStepKey: string;
  toolCallId: string;
  toolName: string;
  capabilityNames: string[];
  reason?: string;
  gateId?: string;
}
```

The implementation may preserve compatibility aliases for existing fields, but the docs should standardize the semantic names above.

## Request Hash Inputs

For `ctx.tool`, the policy request hash should include:

- request kind: `tool.requested`
- tool name
- parsed tool input
- capability declarations visible to policy
- relevant tool call options
- scope key
- step key

If any of these materially change for an already-recorded policy decision, replay should throw `ReplayMismatchError`.

## Implementation Plan

1. Add optional `version?: string` to `PolicyRule`.
2. Add a helper that builds stable policy request identity and request hash for tool requests.
3. Extend `policy.evaluated` schema with `policyVersion`, `requestKind`, and `requestHash`.
4. Decide whether to replace or compatibility-bridge existing `requestType`/`inputHash` fields.
5. Record ordered per-policy `policy.evaluated` events so allow decisions before a terminal decision are auditable.
6. Replay recorded policy decisions without invoking current policy code for that durable request.
7. Validate current request hash against recorded request hash during replay.
8. Derive policy gate step keys from tool step key and policy name.
9. Preserve idempotency for pending, approved, and denied policy gates.
10. Keep legacy requests without policy evidence compatible.
11. Update docs for policy replay, request hashing, ordering, and event taxonomy.

## Test Plan

- Recorded allow decision replays without duplicating `policy.evaluated` or `tool.requested`.
- Recorded deny decision replays without duplicating `agent.failed` or appending `tool.requested`.
- Recorded approval-required decision replays without duplicating `policy.evaluated` or `gate.created` while pending.
- Approved policy gate appends `tool.requested` exactly once.
- Denied policy gate appends `agent.failed` exactly once.
- Tool input change after recorded policy decision raises `ReplayMismatchError` at the policy layer.
- Capability declaration change after recorded policy decision raises `ReplayMismatchError`.
- Multi-policy order: A allows, B denies, C skipped records A and B only.
- Multi-policy order: A allows, B requires approval, C skipped records A and B only.
- Policy version change from `1` to `2` does not break replay of an existing recorded decision.
- A new request records the current policy version.
- Legacy tool requests without `policy.evaluated` remain compatible.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Policy replay semantics are documented and tested.
- [x] Recorded policy decisions are replayed instead of re-evaluating current policy code.
- [x] `policyVersion` is recorded for versioned policies.
- [x] Policy version changes do not fail in-flight replay by default.
- [x] Policy request hash includes tool input and capability declarations.
- [x] Request hash mismatch raises `ReplayMismatchError`.
- [x] Multi-policy ordering is deterministic and tested.
- [x] Deny and approval-required decisions short-circuit later policies.
- [x] Policy-required gates have stable derived identity and are idempotent.
- [x] Legacy events remain compatible.
- [x] Docs distinguish durable policy replay from current policy code evaluation.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Formalize replay semantics.
- [x] Add policy version metadata.
- [x] Add request hash helper and event fields.
- [x] Harden policy gate identity and replay.
- [x] Add multi-policy ordering behavior.
- [x] Add replay and mismatch tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- `policy.evaluated` is durable audit evidence and a durable control decision.
- Replay uses recorded policy decisions for a durable request and does not re-run current policy code.
- Policies execute in `app.policies` order.
- `allow` records evidence and continues to the next policy.
- `deny` records evidence, appends `agent.failed`, and short-circuits later policies.
- `approval_required` records evidence, creates or reuses a deterministic policy gate, and short-circuits later policies.
- Added optional `PolicyRule.version` and recorded `policyVersion` on `policy.evaluated`.
- Policy version changes do not fail replay by default; existing decisions remain source-of-truth.
- Added `requestKind` and `requestHash` to `policy.evaluated` while preserving compatibility fields.
- Request hash includes request kind, scope key, step key, tool name, parsed input, relevant options, and capability declarations.
- Capability declaration changes now cause policy-layer `ReplayMismatchError` for already-recorded policy decisions.
- Policy gate keys are derived from tool step key and policy name: `<tool-step>:policy:<policy-name>:approval`.
- Added tests for recorded allow replay, recorded deny replay, approval-required pending/approved/denied replay, input mismatch, capability mismatch, multi-policy ordering, and policy version audit behavior.
- Updated docs in `docs/declarative-api.md`, `docs/event-taxonomy.md`, `docs/architecture.md`, and `docs/glossary.md`.
- Verified with `npm test` and `npm run typecheck`.
- Remaining limitations: policies still only enforce `ctx.tool`; capability-mediated credentials, policy over other context operations, aggregation, redaction, and external policy services remain follow-up work.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/event-taxonomy.md`
- [x] `docs/architecture.md`
- [x] `docs/glossary.md`
