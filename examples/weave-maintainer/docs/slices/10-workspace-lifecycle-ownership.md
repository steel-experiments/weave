# Workspace Lifecycle Ownership

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Make workspace allocation, ownership, reuse, and cleanup explicit for development initiatives and slices.

Default to one initiative-scoped `WorkspaceRef` so sequential slices can accumulate changes on one branch. Allow per-slice workspaces as an explicit override for isolation-heavy workflows.

## Non-goals

- Do not implement non-git workspace providers.
- Do not add merge, cherry-pick, or patch-stack mechanics for per-slice workspaces.
- Do not run OpenCode directly.
- Do not delete dirty workspaces unless policy explicitly allows it.

## User Outcome

As a maintainer, I know which workspace an initiative owns, when each slice uses it, and whether it will be preserved or cleaned up after completion or failure.

## Architecture Impact

- Adds explicit workspace lifecycle policy to the development orchestrator.
- Moves workspace allocation ownership to the initiative level by default.
- Allows `workspaceMode: "initiative" | "slice"` for workflows that need stronger isolation.
- Ensures `WorkspaceRef` is passed consistently to slice runner, implementer, verifier, reviewers, repair agent, and PR draft aggregation.
- Adds deterministic cleanup or preservation behavior.

## Workspace Mode Recommendation

Default:

```ts
workspaceMode: "initiative"
```

Reason:

- Auth slices build cumulatively on one branch.
- Sequential code changes should be visible to later slices.
- One workspace matches the current working-branch workflow.
- It avoids needing merge/cherry-pick mechanics between slice worktrees.

Optional:

```ts
workspaceMode: "slice"
```

Use this only when isolation is more important than cumulative branch flow.

## Proposed Workspace Policy Shape

```ts
type DevelopmentWorkspaceMode = "initiative" | "slice";

interface DevelopmentWorkspacePolicy {
  mode: DevelopmentWorkspaceMode;
  provider: "git-worktree";
  preserveOnFailure: boolean;
  preserveOnHumanGate: boolean;
  cleanupOnSuccess: boolean;
}
```

## Implementation Plan

1. Add workspace policy schema to initiative and slice runner inputs.
2. Default workspace mode to `initiative`.
3. Allocate one workspace before the first slice when mode is `initiative`.
4. Pass the same `WorkspaceRef` to every slice runner child.
5. Allocate a fresh workspace per slice only when mode is `slice`.
6. Checkpoint allocated workspace refs for replay.
7. Preserve workspace on failure, human gate, or dirty state by default.
8. Cleanup only when policy allows and workspace state is safe.
9. Emit or checkpoint workspace lifecycle summaries.
10. Keep `WorkspaceProvider` as the provider boundary; do not inline git worktree operations into orchestrator agents.

## Test Plan

- Unit test default workspace policy parsing.
- Replay test initiative mode allocates exactly one workspace.
- Replay test initiative mode reuses the same `WorkspaceRef` for multiple slices.
- Replay test slice mode allocates one workspace per slice.
- Replay test workspace allocation is checkpointed and not duplicated after replay.
- Replay test failed initiative preserves workspace.
- Replay test successful initiative requests cleanup only when policy allows.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] Workspace lifecycle policy is explicit and schema-validated.
- [x] Default mode is initiative-scoped workspace reuse.
- [x] Initiative mode allocates one workspace and passes it to every slice.
- [x] Slice mode can allocate one workspace per slice.
- [x] Workspace allocation is checkpointed and replay-safe.
- [x] Dirty or failed workspaces are preserved by default.
- [x] Cleanup uses `WorkspaceProvider` and respects policy.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `git diff --check` passes.

## Progress

- [x] Add workspace policy schemas.
- [x] Add initiative workspace allocation path.
- [x] Add slice workspace allocation path.
- [x] Add checkpoint behavior.
- [x] Add cleanup/preserve decisions.
- [x] Add replay tests.
- [x] Update docs.

## Completion Notes

- Added `DevelopmentWorkspaceModeSchema` and `DevelopmentWorkspacePolicySchema`.
- `DevelopmentInitiativeInputSchema` now accepts optional `workspaceRef` and `workspacePolicy`; the default policy is initiative-scoped `git-worktree`, preserve on failure/human gate, and no cleanup on success.
- `SliceRunnerInputSchema` now accepts optional `workspacePolicy` so child slice runners receive the lifecycle policy used to create their workspace.
- Added `buildWorkspaceAllocateInput(...)` to produce schema-valid `workspace.allocate` inputs without embedding provider internals in the orchestrator.
- Added `shouldCleanupWorkspace(...)` to make cleanup/preserve decisions explicit and testable.
- `createWeaveMaintainerAgent(...)` can accept a `WorkspaceProvider`; when supplied, it registers `workspace.allocate` and `workspace.remove` tools.
- In initiative mode, the maintainer allocates one workspace with key `workspace-allocate:initiative`, checkpoints it under `workspace-ref:initiative`, and passes the same `WorkspaceRef` to every slice child.
- In slice mode, the maintainer allocates with keys `workspace-allocate:<sliceId>`, checkpoints each `workspace-ref:<sliceId>`, and passes a fresh `WorkspaceRef` to each slice child.
- Successful cleanup is opt-in via `cleanupOnSuccess`; cleanup uses `workspace.remove` and respects `requireCleanOnCleanup` and `forceCleanup`.
- Failed or human-gated initiatives preserve workspaces by default via `preserveOnFailure` and `preserveOnHumanGate`.
- Added replay tests for initiative-mode allocation/reuse, slice-mode per-slice allocation, allocation checkpointing, successful cleanup request, and default preservation decisions.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm exec -- tsx src/tests/public-api-exports.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: real OpenCode execution remains slice 11. This slice wires workspace ownership around existing child boundaries only.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
- [ ] `../../slices/57-workspace-provider-boundary.md` if provider contracts change
