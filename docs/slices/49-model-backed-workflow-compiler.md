# Model Backed Workflow Compiler

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-03`
- Owner: `weave-examples`

## Goal

Replace deterministic/demo plan generation with a model-backed compiler that emits validated `WorkflowPlan` data.

## Core Constraint

Model emits schema-validated data only. Weave still interprets the plan. No model-generated JavaScript.

## Non-goals

- Do not execute model-generated JavaScript.
- Do not allow the model to reference unregistered agents silently.
- Do not add a general workflow language.
- Do not add tournaments, loop-until-done, or multi-model routing in this slice.
- Do not bypass policies, gates, capability checks, or child-thread replay semantics.
- Do not require production model credentials for deterministic CI tests.

## User Outcome

As an engineer, I can provide a high-level workflow prompt and document, have a model propose a typed workflow plan, inspect the requested capabilities, and run the plan through the same durable Weave interpreter used by the deterministic example.

## Scope

- Model-backed plan compiler for the existing claim-review workflow family.
- `WorkflowPlan` output must pass Zod validation.
- Plan may only reference registered agents from the example catalog.
- Plan must include deterministic step keys or enough stable data to derive them deterministically.
- Unsafe capability requests must trigger controlled rejection or approval flow before execution.
- CI tests use mocked model outputs.

## Proposed Shape

```ts
const workflowCompilerTool = tool({
  name: "workflow.compilePlan",
  input: WorkflowInputSchema,
  output: WorkflowPlanSchema,
  async run(ctx) {
    return modelStructuredOutput(ctx.input, WorkflowPlanSchema);
  },
});
```

The compiler may be a tool or child agent, but its output remains data. The existing `workflow.customize` runner continues to interpret the validated plan through registered agents and durable effects.

## Architecture Impact

- Adds a model-backed compiler boundary to `examples/prompt-workflow-review`.
- Reuses the current `WorkflowPlan` schema where possible.
- May add plan normalization helpers for deterministic step keys.
- May add plan rejection events or findings if the compiler emits invalid agents/capabilities.
- No core primitive changes expected.

## Implementation Plan

1. Extract the deterministic compiler behind a `WorkflowCompiler` interface.
2. Add a model-backed compiler implementation that requests structured `WorkflowPlan` data.
3. Add strict validation and normalization for model output.
4. Reject plans that reference unregistered agents.
5. Reject or gate plans that request unsafe capabilities.
6. Keep deterministic/mock compiler as the default test path.
7. Add demo option or fixture to show model-compiled plan behavior without requiring live model credentials.
8. Update docs with the data-only safety model.

## Test Plan

- Unit test valid mocked model output becomes a normalized `WorkflowPlan`.
- Unit test invalid model output is rejected before execution.
- Unit test unregistered agents are rejected.
- Unit test unsafe capabilities are gated or rejected before child spawn.
- Integration test model-backed compilation with mocked model output and real Weave runner/service boundaries.
- Regression test that model output cannot introduce executable JavaScript.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Model-backed compiler emits `WorkflowPlan` data only.
- [ ] `WorkflowPlan` output is schema-validated before execution.
- [ ] Plans referencing unregistered agents are rejected or routed to human review.
- [ ] Unsafe capabilities do not execute silently.
- [ ] Deterministic/mock tests do not require live model credentials.
- [ ] No model-generated JavaScript is executed.
- [ ] Existing prompt workflow demo still works.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Extract compiler interface.
- [ ] Add model-backed compiler boundary.
- [ ] Add validation and rejection tests.
- [ ] Wire mocked model compiler into tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md` if public guidance changes
- [ ] `docs/glossary.md` if compiler vocabulary becomes shared
- [ ] `examples/prompt-workflow-review` docs or README if added
