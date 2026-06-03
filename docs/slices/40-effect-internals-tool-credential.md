# Effect Internals Tool And Credential Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
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

- [x] Tool execution internals use Effect or a clearly isolated Effect adapter.
- [x] Credential resolution internals use Effect or a clearly isolated Effect adapter.
- [x] Public tool contracts remain Promise-first and unchanged.
- [x] Public agent authoring remains Promise-first and unchanged.
- [x] Existing emitted event behavior is preserved or intentionally documented.
- [x] Existing observability behavior is preserved or intentionally documented.
- [x] Docs state Effect is internal and not required for V1 authoring.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Inventory current tool-worker behavior.
- [x] Add parity tests where missing.
- [x] Refactor smallest internal path.
- [x] Preserve public adapters.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added `src/internal-effect.ts`, a small isolated Effect-style adapter returning typed success/failure results without adding a public dependency or changing author APIs.
- Wrapped credential provider resolution in the adapter with typed internal `credential_provider_error` failures.
- Wrapped `ToolContract.run(ctx)` execution in the adapter with typed internal `tool_execution_failed` failures while preserving retry behavior for `RetryableToolError`.
- Preserved public `ContractToolWorker.processOnce(...)`, `ToolContract.run(ctx)`, and `CredentialProvider.resolve(...)` Promise-first behavior.
- Preserved emitted event behavior for success, output validation failure, missing credentials, credential provider errors, retryable tool errors, and terminal execution failure.
- Preserved existing observability calls around tool execution and credential resolution.
- Added parity tests for output validation failure, credential missing, credential provider error, retryable success, and terminal execution failure.
- Verified with `npm test` and `npm run typecheck`.
- Follow-up slices can move more runner/worker internals onto a richer Effect runtime if the project adopts an external Effect dependency later.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md` limitations if wording changes
- [x] `docs/architecture.md`
- [x] `docs/migration/api-refactor.md` only if author guidance changes
