# Parallel Durable Effects Guardrails Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Make unsupported parallel durable effects fail deterministically instead of relying on `Promise.all` rejection ordering or silently appending only one suspended effect.

## Non-goals

- Do not implement parallel durable effect execution yet.
- Do not add batch APIs yet.
- Do not reject multiple non-suspending emitted facts in one replay pass.

## User Outcome

As a Weave app author, if I accidentally write `Promise.all([ctx.tool(...), ctx.tool(...)])`, I get a clear `PARALLEL_DURABLE_EFFECT` error telling me to await durable effects sequentially.

## Architecture Impact

- Adds `ParallelDurableEffectError`.
- Tracks the first suspending durable effect in a replay pass.
- If another suspending `ctx.tool` or `ctx.gate` starts before that suspension is reconciled, the run-first adapter throws `ParallelDurableEffectError`.
- Existing sequential `ctx.tool` / `ctx.gate` flows are unchanged.

## Acceptance Criteria

- [x] `Promise.all([ctx.tool(...), ctx.tool(...)])` rejects with `ParallelDurableEffectError`.
- [x] Sequential durable effects still work.
- [x] Existing SRE and Steel demos still pass.
- [x] Docs state parallel durable effects are unsupported in V1.

## Completion Notes

Changed modules:

- `src/errors.ts`: `ParallelDurableEffectError`.
- `src/agent-runner.ts`: suspending effect tracking and deterministic parallel error propagation.
- `src/tests/replay-authoring.test.ts`: regression coverage for rejected parallel tools.
- `docs/declarative-api.md`: documents the guardrail.

Known follow-ups:

- Explicit batched durable effect API if parallel tool requests become a product requirement.
- Richer diagnostics for which source locations started each parallel effect.
