# Workspace Provider Boundary

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-core`

## Goal

Define a provider-neutral workspace allocation boundary so Weave workflows can run coding agents in isolated workspaces without hardcoding Git worktrees as the only workspace model.

The first implementation should use Git worktrees. The boundary should leave room for future providers such as Rift-style CoW workspaces, btrfs/ZFS/APFS snapshots, Firecracker snapshots, Docker volumes, or remote sandboxes.

## Non-goals

- Do not implement Rift or filesystem CoW providers in this slice.
- Do not require btrfs, ZFS, APFS, Firecracker, Docker, or privileged host setup.
- Do not replace Git branch and diff semantics.
- Do not let workspace providers bypass Weave policy, gates, or capability checks.
- Do not treat filesystem snapshots as a security sandbox.
- Do not implement OpenCode patching in this slice.

## User Outcome

As a workflow author, I can ask Weave to allocate a workspace for one bounded slice and receive a durable `WorkspaceRef` without caring whether the backing implementation is a Git worktree today or a CoW/sandbox provider later.

## Architecture Impact

- Adds workspace lifecycle vocabulary to Weave core: provider, workspace ref, allocation, state, diff, promotion, and cleanup.
- Makes branch/worktree control a specialization of a broader workspace provider contract.
- Keeps Git as the source of truth for branch, commit, diff, and PR behavior in the first provider.
- Adds tool contracts that can be policy-mediated by `workspace.allocate`, `workspace.inspect`, `workspace.remove`, `workspace.promote`, `repo.read`, `repo.write.branch`, and `repo.createBranch` capabilities.
- Gives the development orchestrator a stable workspace abstraction before OpenCode implementation work begins.
- Does not require new replay primitives; workspace allocation and cleanup should be normal durable tools/checkpoints.

## Proposed Contract

Workspace reference:

```ts
type WorkspaceRef = {
  provider: "git-worktree" | string;
  workspaceId: string;
  path: string;
  repo: string;
  baseBranch: string;
  workingBranch: string;
  baseCommit: string;
  parentWorkspaceId?: string;
  metadata?: Record<string, unknown>;
};
```

Provider interface:

```ts
type WorkspaceProvider = {
  name: string;
  allocate(input: WorkspaceAllocateInput): Promise<WorkspaceRef>;
  state(ref: WorkspaceRef): Promise<WorkspaceState>;
  diff(ref: WorkspaceRef): Promise<WorkspaceDiff>;
  remove(ref: WorkspaceRef): Promise<WorkspaceRemovalResult>;
  promote?(ref: WorkspaceRef, target: WorkspacePromotionTarget): Promise<WorkspacePromotionResult>;
};
```

Initial tools:

- `workspace.allocate`
- `workspace.state`
- `workspace.diff`
- `workspace.remove`

Optional later tool:

- `workspace.promote`

Initial provider:

- `git-worktree`: creates or confirms a Git worktree for a working branch, records the workspace path, confirms base commit and branch state, and removes the worktree when safe.

Future providers:

- `rift-cow`: Rift-backed CoW workspace using btrfs/reflink/APFS clone support.
- `zfs-clone`: ZFS snapshot/clone-backed workspace for managed builder pools.
- `firecracker-snapshot`: VM snapshot-backed workspace for stronger runtime isolation.
- `remote-sandbox`: hosted sandbox provider that returns remote path, connection info, and artifact endpoints.

## Provider Semantics

All providers should provide the same durable facts:

- workspace id
- provider name
- workspace path or remote locator
- repo identity
- base branch
- working branch
- base commit
- current commit
- dirty state
- changed files
- cleanup status

Provider-specific metadata may include Rift ancestry, btrfs subvolume id, ZFS dataset name, Firecracker snapshot id, container id, or remote sandbox id, but orchestrators should not depend on those fields for normal control flow.

## Git Worktree MVP

The first provider should be intentionally conservative:

1. Allocate a deterministic workspace path under a configured workspace root.
2. Create or confirm a Git worktree for the requested working branch.
3. Reject writes to `main`.
4. Confirm the worktree branch, base commit, and current commit.
5. Return a schema-validated `WorkspaceRef`.
6. Provide `workspace.state` and `workspace.diff` tools.
7. Provide safe `workspace.remove` only for known allocated workspace paths.
8. Checkpoint `WorkspaceRef` so replay does not allocate a second workspace for the same slice.

## Rift And CoW Future Shape

Rift-style providers should fit behind the same contract:

```txt
workspace.allocate
  -> rift create --name <slice-id> --into <workspace-root>
  -> validate .rift marker and Git state
  -> return WorkspaceRef(provider: "rift-cow", ...)

workspace.diff
  -> git diff / changed files from the Rift workspace

workspace.promote
  -> produce patch or push branch from the workspace

workspace.remove
  -> rift remove / gc according to policy
```

Rift should be optional because it depends on filesystem support and is still experimental. It is useful for fast local and managed-host workspaces, but Git worktrees should remain the portable default.

## Capability Boundaries

Suggested capabilities:

- `workspace.allocate`
- `workspace.inspect`
- `workspace.diff`
- `workspace.remove`
- `workspace.promote`
- `repo.read`
- `repo.write.branch`
- `repo.createBranch`

Policy requirements:

- Deny allocation directly on `main`.
- Deny removal outside known workspace roots.
- Require human approval before destructive cleanup if a workspace has uncommitted changes and no diff artifact was captured.
- Require provider capability checks before enabling non-portable providers such as Rift, ZFS, Docker, or Firecracker.
- Require stricter review for providers that need host privileges or persistent daemon access.

## Implementation Plan

1. Define `WorkspaceRef`, `WorkspaceState`, `WorkspaceDiff`, `WorkspaceProvider`, and tool input/output schemas.
2. Add provider-neutral workspace capability names and policy examples.
3. Implement a `git-worktree` provider that can allocate, inspect, diff, and remove workspaces under a configured root.
4. Add deterministic workspace ids and paths keyed by initiative, slice id, and branch.
5. Checkpoint `WorkspaceRef` during allocation so replay reuses the same workspace.
6. Update development orchestrator slice-runner docs/contracts to consume `WorkspaceRef` instead of only `branch` and current worktree state.
7. Document future provider requirements for Rift/CoW and Firecracker-style sandboxes.

## Test Plan

- Unit test workspace schema validation.
- Unit test deterministic workspace id/path generation.
- Unit test policy rejects `main` as a writable workspace target.
- Unit test cleanup refuses paths outside the configured workspace root.
- Integration test `git-worktree` allocation creates or confirms a workspace for a temporary repo.
- Integration test `workspace.state` reports branch, commit, dirty state, and changed files.
- Integration test `workspace.diff` returns bounded diff metadata.
- Replay test workspace allocation is checkpointed and not repeated.
- Failure-path test missing branch, dirty cleanup, invalid root, and provider unavailable cases.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Provider-neutral workspace contracts exist.
- [x] Git worktree provider can allocate, inspect, diff, and remove workspaces under a configured root.
- [x] Workspace allocation is replay-safe through a checkpointed `WorkspaceRef`.
- [x] Writes to `main` are denied by default policy.
- [x] Cleanup cannot remove arbitrary paths outside known workspace roots.
- [x] Development orchestrator contracts can refer to `WorkspaceRef` rather than only a branch/current checkout.
- [x] Rift/CoW and Firecracker future provider requirements are documented without being implemented.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Workspace contracts.
- [x] Workspace capabilities and policies.
- [x] Git worktree provider.
- [x] Allocation checkpointing.
- [x] State/diff/remove tools.
- [x] Development orchestrator handoff docs.
- [x] Future provider notes.
- [x] Tests.

## Completion Notes

- Added `src/workspace-provider.ts` with provider-neutral schemas and types for `WorkspaceRef`, allocation input, workspace state, diff, removal, promotion targets, and provider implementations.
- Added provider-backed tool factories for `workspace.allocate`, `workspace.state`, `workspace.diff`, and `workspace.remove`.
- Added workspace capabilities for allocation, inspection, diff reads, and removal.
- Added `GitWorktreeWorkspaceProvider`, which creates or confirms Git worktrees under a configured workspace root, rejects writable `main` allocation, inspects branch/commit/dirty state, returns bounded diffs, and removes only paths inside known workspace roots.
- Added deterministic workspace id/path helpers for replay-safe allocation through normal `ctx.checkpoint("workspace-ref", ...)` usage.
- Updated development orchestrator contracts so slice runner and OpenCode implementer inputs can carry `WorkspaceRef`.
- Added `src/tests/workspace-provider.test.ts`, which exercises a real temporary Git repository and worktree lifecycle: allocate, inspect, dirty diff, blocked dirty removal, blocked outside-root removal, forced removal, and missing removal.
- Updated public export smoke coverage and root `npm test`.
- Commands run: `npm exec -- tsx src/tests/workspace-provider.test.ts`, `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: the current provider allocates Git worktrees only. Rift/CoW, Firecracker, remote sandbox providers, PR promotion, and orchestrator runtime allocation wiring remain follow-up work.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/architecture.md`
- [x] `docs/development-orchestrator/README.md`
- [x] `docs/development-orchestrator/slices/03-slice-runner-branch-control.md`
- [x] `docs/development-orchestrator/slices/04-opencode-implementer-boundary.md`
