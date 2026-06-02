# Effect Internals Tool And Credential Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Introduce Effect-backed internals for low-risk runtime boundaries, starting with tool execution and credential resolution, without changing the Promise-first public authoring API.

## Non-goals

- Do not require app authors to import or write Effect code.
- Do not change `agent.run`, `ctx.tool`, or tool contract syntax.
- Do not rewrite the whole runner in this slice.
- Do not change event taxonomy unless better error evidence is required.
- Do not add policy or capability features; depend on prior slices for those.

## User Outcome

As a maintainer, I get better internal resource safety, typed failures, and composable observability in tool and credential execution without changing public app code.

## Architecture Impact

- Refactors internal implementation of `ContractToolWorker` and credential resolution paths.
- Preserves `ToolContract.run(ctx)` and `CredentialProvider.resolve(...)` public behavior.
- May introduce internal adapters from Promise APIs into Effect programs.
- Should keep emitted events and worker results compatible unless a bug fix requires a documented change.
- Provides a low-risk path for later Effect-backed runner internals.

## Implementation Plan

1. Identify the smallest internal tool-worker execution path to wrap in Effect.
2. Model credential resolution and tool execution errors as typed internal failures.
3. Preserve current emitted event behavior for success, validation failure, credential failure, retryable failure, and terminal execution failure.
4. Preserve current observability span/log emission behavior.
5. Keep public Promise-returning methods as compatibility adapters.
6. Add regression tests proving event and result parity before and after the refactor.
7. Document that Effect is an internal implementation detail, not a V1 authoring requirement.

## Test Plan

- Existing tool-worker tests remain green.
- Golden behavior tests for successful tool execution, output validation failure, credential missing, credential provider error, retryable tool error, and terminal execution failure.
- Observability smoke test for span/log preservation if practical.
- Typecheck public examples to prove no authoring API change.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Tool execution internals use Effect or a clearly isolated Effect adapter.
- [ ] Credential resolution internals use Effect or a clearly isolated Effect adapter.
- [ ] Public tool contracts remain Promise-first and unchanged.
- [ ] Public agent authoring remains Promise-first and unchanged.
- [ ] Existing emitted event behavior is preserved or intentionally documented.
- [ ] Existing observability behavior is preserved or intentionally documented.
- [ ] Docs state Effect is internal and not required for V1 authoring.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Inventory current tool-worker behavior.
- [ ] Add parity tests where missing.
- [ ] Refactor smallest internal path.
- [ ] Preserve public adapters.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- internal paths changed
- public API compatibility evidence
- parity tests added
- commands run
- follow-up Effect internals slices

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md` limitations if wording changes
- [ ] `docs/architecture.md`
- [ ] `docs/migration/api-refactor.md` only if author guidance changes
