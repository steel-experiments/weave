# Maintainer OpenCode Security Hardening

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-15`
- Owner: `weave-maintainer`

## Goal

Close the current security gap in the Weave Maintainer OpenCode adapter before it is used for more dogfood implementation work.

## Non-goals

- Do not design the final public `weave/opencode` abstraction in this slice.
- Do not add provider-specific OpenCode session persistence.
- Do not make the maintainer fully autonomous.
- Do not rely on prompt instructions as the only security control.
- Do not allow broad shell/network/secret access because OpenCode happens to run in a worktree.

## User Outcome

As a maintainer operator, I can run OpenCode-backed implementation and repair slices knowing the adapter enforces a bounded permission profile, validates actual workspace changes, and fails closed when OpenCode asks for capabilities outside the slice boundary.

## Architecture Impact

- Keeps the immediate fix in `examples/weave-maintainer` while the hardened framework adapter is planned separately.
- Turns the current prompt-only boundary into an adapter-enforced permission profile.
- Adds actual Git diff inspection after OpenCode runs so self-reported `filesChanged` is not trusted.
- Adds explicit environment sanitization and command-argument validation before spawning OpenCode.
- Makes maintainer tests prove security failure paths, not just happy-path command execution.

## Security Model

The maintainer adapter must enforce defense in depth:

- Weave tool capabilities declare intended authority before the tool runs.
- The OpenCode CLI command is launched with an explicit permission/tool profile.
- The process is scoped to `WorkspaceRef.path` and a required branch.
- Environment variables are deny-by-default unless explicitly allowed.
- Actual workspace diff is checked after the run.
- OpenCode output is schema-validated, but never trusted as the only source of changed-file truth.

## Implementation Plan

1. Add an `OpenCodePermissionProfileSchema` to `examples/weave-maintainer/src/opencode-runner.ts`.
2. Make the default profile deny secrets, network, PR publishing, branch switching, repository operations outside the workspace, and uncontrolled shell commands.
3. Add config fields for the OpenCode CLI permission/tool flags the local OpenCode binary supports.
4. Reject runner configs that omit a permission profile unless an explicit test-only unsafe override is set.
5. Sanitize child process env to a minimum safe allowlist plus explicit config entries.
6. Capture actual changed files with Git before and after OpenCode runs.
7. Reject implementation and repair runs when actual changed files escape `allowedFiles` or the workspace root.
8. Add failure handling for OpenCode permission requests that do not match the configured profile.
9. Update maintainer prompts to describe the enforced profile, but do not rely on prompts for enforcement.
10. Document the residual risk that local CLI sandboxing still depends on the host OpenCode binary honoring its permission flags.

## Test Plan

- Unit test permission profile parsing rejects empty or unsafe profiles by default.
- Unit test command args include the expected OpenCode permission/tool flags.
- Unit test env sanitization excludes common secret variables unless explicitly allowed.
- Fake executable test attempts to report only allowed files while modifying an out-of-scope file; the runner must fail.
- Fake executable test emits permission-request output; the runner must become blocked.
- Fake executable test verifies branch mismatch still blocks before process launch.
- Fake executable test verifies timeout and max-output behavior still fail closed.
- Maintainer integration test proves `dev.opencode.implement` still returns a structured blocked result instead of crashing when security checks fail.
- Run `npm --workspace weave-maintainer run test`, `npm --workspace weave-maintainer run typecheck`, `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] OpenCode runner config requires an explicit permission profile or a named unsafe test override.
- [x] The spawned OpenCode process receives a bounded tool/permission profile.
- [x] Child process env is deny-by-default with an explicit allowlist.
- [x] Actual Git diff after the run is checked against `allowedFiles` and workspace root.
- [x] Out-of-scope actual file changes fail even when OpenCode reports an in-scope summary.
- [x] Permission requests outside the profile become structured blocked results.
- [x] Existing maintainer implementation and repair happy paths still work under the hardened profile.
- [x] Documentation clearly states remaining host-level trust assumptions.

## Progress

- [x] Define permission profile schema.
- [x] Wire OpenCode CLI permission/tool flags.
- [x] Add env sanitization.
- [x] Add actual Git diff enforcement.
- [x] Add fake executable security tests.
- [x] Update maintainer docs.

## Completion Notes

- Implemented `OpenCodePermissionProfileSchema` in `examples/weave-maintainer/src/opencode-runner.ts` with a required `maintainer-bounded` profile and an explicitly named `test-only-unsafe` override.
- Added `createMaintainerOpenCodePermissionProfile(...)`, `createTestOnlyUnsafeOpenCodePermissionProfile(...)`, and `buildOpenCodeChildEnv(...)`.
- Runner config now fails closed when no safe profile is supplied, when maintainer profiles allow unsafe authority, or when command/profile flags include forbidden session, remote, file attachment, shell-command, or `--dangerously-skip-permissions` authority.
- Spawned OpenCode runs receive profile-controlled CLI flags. The bounded maintainer profile includes `--pure`; optional tool narrowing can be supplied through validated `cliToolFlags` such as `--agent <name>`.
- Child process env is deny-by-default from `envAllowlist`; common secret-shaped env keys are rejected in the maintainer profile and omitted unless using the literal `test-only-unsafe` profile.
- `runOpenCodeCliCommand(...)` captures Git changed files before and after successful process exits using `git status --porcelain=v1 -z --untracked-files=all` and records `gitChangedFilesBefore`, `gitChangedFilesAfter`, and workspace-escape fields in `OpenCodeCommandResultSchema`.
- Implementation and repair runners check actual Git changed files against `allowedFiles` and block with `DevelopmentBlockedRunnerError` when changes escape scope, even if OpenCode reports only allowed files.
- Branch mismatches, timeouts, max-output overflow, reported out-of-scope files, actual out-of-scope files, and permission requests outside the profile now fail closed as blocked runner errors where the maintainer tool boundary can return structured blocked outputs.
- `examples/weave-maintainer/src/scripts/initiative-run.ts` and `examples/weave-maintainer/src/scripts/auth-gateway-slice-51-dry-run.ts` now pass the explicit bounded profile to implementation and repair runners.
- `examples/weave-maintainer/src/tests/opencode-runner.test.ts` now uses Git-backed fake workspaces and covers profile parsing, bounded profile flags, env sanitization, branch preflight before launch, actual out-of-scope file changes, unsupported permission requests, structured tool-level blocked output, timeout, max-output, and forbidden flags.
- Validation commands run and passed: `npm --workspace weave-maintainer run test`, `npm --workspace weave-maintainer run typecheck`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gaps: this slice does not implement the public `weave/opencode` adapter from slices 59 or 60. Host-level security still depends on the installed OpenCode binary honoring its CLI permission behavior and on the host OS/user account; this adapter strips env and validates Git results after execution, but it is not an OS sandbox for network, filesystem symlink targets, local credential files, or arbitrary behavior inside the OpenCode binary.

## Docs To Update On Completion

- [x] this slice document
- [x] `examples/weave-maintainer/docs/README.md`
- [x] `examples/weave-maintainer/docs/slices/11-real-opencode-runner-adapter.md`
- [x] `docs/agent-adapters.md`
