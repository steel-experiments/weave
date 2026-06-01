# Public API Polish Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Make the public app authoring boundary consistent around the short names `weave`, `agent`, `tool`, and `integration` while keeping existing `define*` exports compatible.

## Non-goals

- Do not split package subpaths yet.
- Do not hide runtime internals from the root export yet.
- Do not redesign app runtime binding.

## User Outcome

As a Weave app author, I can write:

```ts
const app = weave({
  name: "example",
  agents: [agent({ name: "worker", async run(ctx, input) {} })],
});
```

## Architecture Impact

- `weave` remains the primary alias for `defineWeaveApp`.
- `agent` and `tool` remain the primary aliases for `defineAgent` and `defineTool`.
- `integration` is added as the primary alias for `defineIntegration`.
- `weave-interface.ts` now reflects run-first agents, app-level tools, gate/checkpoint/emit context helpers, and short authoring aliases.
- Examples use short public authoring names.

## Acceptance Criteria

- [x] `integration` is exported as an alias for `defineIntegration`.
- [x] SRE and Steel examples use `weave`, `agent`, and `tool` where applicable.
- [x] `weave-interface.ts` no longer describes agents as planner-only.
- [x] Docs prefer `weave`, `agent`, `tool`, and `integration`.
- [x] Existing `define*` names remain exported for compatibility.

## Completion Notes

Changed modules:

- `src/integration-contract.ts`: exports `integration` alias.
- `src/weave-interface.ts`: updates the public boundary sketch to match current authoring primitives.
- `examples/sre-demo/src/*`: uses short authoring names.
- `examples/steel-docs-sync/src/*`: uses short authoring names.
- `docs/declarative-api.md` and `docs/integrations.md`: prefer short names.

Known follow-ups:

- Split runtime/storage/server exports into package subpaths.
- Decide when to de-emphasize or remove `define*` names from docs entirely.
