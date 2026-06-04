# Workspace Lifecycle Ownership

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
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

- [ ] Workspace lifecycle policy is explicit and schema-validated.
- [ ] Default mode is initiative-scoped workspace reuse.
- [ ] Initiative mode allocates one workspace and passes it to every slice.
- [ ] Slice mode can allocate one workspace per slice.
- [ ] Workspace allocation is checkpointed and replay-safe.
- [ ] Dirty or failed workspaces are preserved by default.
- [ ] Cleanup uses `WorkspaceProvider` and respects policy.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Add workspace policy schemas.
- [ ] Add initiative workspace allocation path.
- [ ] Add slice workspace allocation path.
- [ ] Add checkpoint behavior.
- [ ] Add cleanup/preserve decisions.
- [ ] Add replay tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
- [ ] `../../slices/57-workspace-provider-boundary.md` if provider contracts change
