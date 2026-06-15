# Maintainer Adopts Weave OpenCode Adapter

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-15`
- Owner: `weave-maintainer`

## Goal

Replace the maintainer's example-local OpenCode CLI runner with the hardened `weave/opencode` adapter, while keeping maintainer-specific prompts, schemas, slice orchestration, and review gates in `examples/weave-maintainer`.

## Non-goals

- Do not move the entire maintainer app back into core.
- Do not duplicate the hardened adapter implementation in the maintainer example.
- Do not loosen the maintainer security profile to preserve old behavior.
- Do not make OpenCode responsible for verification, review, PR creation, or finalization.

## User Outcome

As a maintainer operator, I can keep using `npm run initiative:run`, but OpenCode execution goes through the same hardened framework adapter that other Weave apps use.

## Architecture Impact

- `examples/weave-maintainer` becomes a consumer of `weave/opencode`.
- Maintainer-specific runner code shrinks to prompt construction and schema mapping.
- Security enforcement localizes in the framework adapter instead of drifting in an example.
- Maintainer app policy becomes explicit about which OpenCode capabilities are allowed for implementation and repair roles.

## Implementation Plan

1. Replace `examples/weave-maintainer/src/opencode-runner.ts` internals with a thin wrapper around `weave/opencode`, or delete it if direct usage is clearer.
2. Map `OpenCodeImplementerInputSchema` to the generic `weave/opencode` run input.
3. Map `RepairAgentInputSchema` to the generic `weave/opencode` run input.
4. Define maintainer implementation and repair permission profiles with separate allowed tools and shell commands.
5. Install a maintainer app policy that explicitly allows those profiles and denies unexpected OpenCode capabilities.
6. Preserve existing structured output schemas for implementation summaries and repair results.
7. Preserve actual diff enforcement for `allowedFiles` through the framework adapter.
8. Update maintainer tests to assert it imports and uses `weave/opencode` instead of carrying a standalone security implementation.
9. Update root scripts only if command names or environment variables change.

## Test Plan

- Maintainer unit tests for implementation prompt-to-adapter input mapping.
- Maintainer unit tests for repair prompt-to-adapter input mapping.
- Maintainer policy test denies an OpenCode capability not in the implementation profile.
- Maintainer policy test denies an OpenCode capability not in the repair profile.
- Fake executable tests still cover implementation success, repair success, permission denial, out-of-scope actual changes, invalid JSON, and timeout.
- Integration test through `createOpenCodeImplementationTool(...)` proves blocked adapter results become structured blocked tool outputs.
- Run `npm --workspace weave-maintainer run test`, `npm --workspace weave-maintainer run typecheck`, `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] Maintainer OpenCode execution uses `weave/opencode`.
- [x] Maintainer no longer owns a standalone security-sensitive OpenCode CLI implementation.
- [x] Implementation and repair roles have distinct explicit permission profiles.
- [x] Maintainer app policy denies unexpected OpenCode capabilities.
- [x] Existing maintainer commands continue to work.
- [x] Existing maintainer verification/review gates remain mandatory after OpenCode runs.
- [x] Tests prove the maintainer cannot regress to prompt-only enforcement.

## Progress

- [x] Wrap or replace local OpenCode runner.
- [x] Define implementation permission profile.
- [x] Define repair permission profile.
- [x] Add maintainer app policy.
- [x] Update tests and docs.

## Completion Notes

- Replaced the security-sensitive internals of `examples/weave-maintainer/src/opencode-runner.ts` with a thin wrapper around `createOpenCodeCliAdapter(...)`, `runOpenCodeCliCommand(...)`, and permission profiles from `weave/opencode`.
- Kept maintainer-owned prompt builders, `ImplementationSummarySchema`, `RepairResultSchema`, branch preflight, reported-file claim mapping, and `DevelopmentBlockedRunnerError` result mapping in the maintainer app.
- Added `buildOpenCodeImplementationRunInput(...)` and `buildOpenCodeRepairRunInput(...)` to map maintainer inputs to generic `OpenCodeRunInput` with `workspace`, `prompt`, and per-slice `allowedPaths`.
- Added distinct `weave-maintainer-implementation` and `weave-maintainer-repair` profiles through `opencodePermissionProfile(...)`. Both deny network, secrets, Git commit/branch-switch/push, and rely on framework actual-diff enforcement for per-run `allowedFiles`.
- Added `createMaintainerOpenCodePolicy(...)`, and wired it into `initiative:run` and `auth:dry-run`, so unexpected `opencode.*` capability requests are denied at app policy evaluation.
- Exposed adapter profile capabilities through `dev.opencode.implement` and `dev.opencode.repair` tool capability declarations, without moving prompts, schemas, slice orchestration, verification, review, checkpointing, or finalization into core.
- Updated `examples/weave-maintainer/src/tests/opencode-runner.test.ts` to cover implementation and repair prompt-to-adapter input mapping, distinct profiles, policy denial of unexpected OpenCode capabilities, fake executable implementation and repair success, permission denial, out-of-scope actual changes, reported out-of-scope claims, invalid JSON, invalid schema output, timeout, max-output, repair blocked output, and a static guard that `opencode-runner.ts` imports `weave/opencode` and does not import `node:child_process`, call `spawn`/`execFile`, or carry Git status parsing.
- Validation commands run and passed: `npm --workspace weave-maintainer exec -- tsx src/tests/opencode-runner.test.ts`, `npm --workspace weave-maintainer run typecheck`, `npm --workspace weave-maintainer run test`, `npm test`, `npm run typecheck`, and `git diff --check`.
- Known gap: `weave/opencode` is still a hardened process wrapper, not an OS sandbox. Host/OpenCode binary trust assumptions remain inherited from `weave/opencode`: the installed binary, host user account, filesystem permissions, symlink/config exposure, and credentials outside the sanitized process environment must still be trusted.

## Docs To Update On Completion

- [x] this slice document
- [x] `examples/weave-maintainer/docs/README.md`
- [x] `examples/weave-maintainer/docs/slices/11-real-opencode-runner-adapter.md`
- [x] `docs/agent-adapters.md`
