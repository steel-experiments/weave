# Model Backed Workflow Compiler

## Status

- Vertical: `weave-core`
- Status: `Shipped`
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

- [x] Model-backed compiler emits `WorkflowPlan` data only.
- [x] `WorkflowPlan` output is schema-validated before execution.
- [x] Plans referencing unregistered agents are rejected or routed to human review.
- [x] Unsafe capabilities do not execute silently.
- [x] Deterministic/mock tests do not require live model credentials.
- [x] No model-generated JavaScript is executed.
- [x] Existing prompt workflow demo still works.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Extract compiler interface.
- [x] Add model-backed compiler boundary.
- [x] Add validation and rejection tests.
- [x] Wire mocked model compiler into tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added `WorkflowCompiler` and `compileWorkflowPlanWithCompiler(...)` in `examples/prompt-workflow-review/src/workflow-compiler.ts`.
- Kept the deterministic plan generator as the default compiler while allowing tests and demos to inject a mocked model-backed compiler.
- Added `normalizeWorkflowPlan(...)` validation for schema conformance, registered agent references, unsafe capability rejection mode, and executable-looking fields such as `generatedJavaScript`.
- Wired `workflow.customize` through the compiler boundary before its durable `ctx.checkpoint("workflow-plan", ...)` completes.
- Added tests proving valid mocked model data runs through real Weave runner/service boundaries and invalid mocked model data is rejected before execution.
- Verification run:
- `npm --workspace weave-prompt-workflow-review run test`
- `npm --workspace weave-prompt-workflow-review run typecheck`
- `npm test`
- `npm run typecheck`
- `git diff --check`

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md` if public guidance changes
- [ ] `docs/glossary.md` if compiler vocabulary becomes shared
- [ ] `examples/prompt-workflow-review` docs or README if added
