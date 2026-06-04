import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { defineWeaveApp } from "../app-contract.js";
import type { CredentialProvider, CredentialRequest, CredentialResolution, CredentialResolutionContext } from "../credentials.js";
import { createPool } from "../db.js";
import {
  DevelopmentInitiativeInputSchema,
  createOpenCodeImplementerAgent,
  createPrAgent,
  createRepairAgent,
  createReviewerAgent,
  createSliceRunnerAgent,
  createVerificationAgent,
  createWeaveMaintainerAgent,
  type DevelopmentReviewerRole,
  type ReviewerAgentInput,
  type ReviewerRunner,
  type VerificationAgentInput,
  type VerificationResult,
} from "../development-orchestrator.js";
import type { DevCommandResult, DevReviewFinding, ThreadEvent, ThreadProjection } from "../events.js";
import { migrate } from "../migrate.js";
import { createOpenCodeCliImplementationRunner, createOpenCodeCliRepairRunner } from "../opencode-runner.js";
import { PostgresObservabilitySink } from "../postgres-observability.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
import { createWeaveRuntime } from "../runtime.js";
import { ThreadService } from "../thread-service.js";
import { toTextTimeline } from "../timeline.js";
import { GitWorktreeWorkspaceProvider, type WorkspaceProvider } from "../workspace-provider.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const authSliceId = "51-auth-gateway-thread-start";
const requiredReviewers = [
  "security-reviewer",
  "replay-safety-reviewer",
  "compatibility-reviewer",
  "docs-reviewer",
] satisfies DevelopmentReviewerRole[];

const options = parseOptions(process.argv.slice(2));
const baseBranch = options.baseBranch ?? (await currentGitBranch(repoRoot));
const defaultWorkingBranch = baseBranch === "auth-gateway-slice-51-dry-run" ? "auth-gateway-slice-51-dry-run-workspace" : "auth-gateway-slice-51-dry-run";
const workingBranch = options.workingBranch ?? process.env.WEAVE_DRY_RUN_WORKING_BRANCH ?? defaultWorkingBranch;
const workspaceRoot = options.workspaceRoot ?? process.env.WEAVE_DRY_RUN_WORKSPACE_ROOT ?? path.join("/tmp", "weave-development-workspaces");
const timeoutMs = options.timeoutMs ?? 900_000;
const idempotencyKey = options.idempotencyKey ?? `auth-gateway-slice-51-dry-run:v7:${baseBranch}:${workingBranch}`;
const workspaceProvider = new GitWorktreeWorkspaceProvider();

class LocalDryRunCredentialProvider implements CredentialProvider {
  async resolve(request: CredentialRequest, context: CredentialResolutionContext): Promise<CredentialResolution> {
    return {
      name: request.name,
      kind: request.kind,
      source: "auth-gateway-slice-51-dry-run",
      subject: context.toolName,
    };
  }
}

const initiativeInput = DevelopmentInitiativeInputSchema.parse({
  initiative: "Auth Gateway",
  repo: "weave",
  baseBranch,
  workingBranch,
  contextFiles: [
    "docs/slices/51-auth-gateway-thread-start.md",
    "docs/development-orchestrator/README.md",
    "docs/agent-adapters.md",
    "docs/architecture.md",
    "docs/declarative-api.md",
    "docs/event-taxonomy.md",
  ],
  workspacePolicy: {
    mode: "initiative",
    provider: "git-worktree",
    sourceRepoPath: repoRoot,
    workspaceRoot,
    preserveOnFailure: true,
    preserveOnHumanGate: true,
    cleanupOnSuccess: false,
    requireCleanOnCleanup: true,
    forceCleanup: false,
  },
  slices: [
    {
      id: authSliceId,
      title: "Auth Gateway Thread Start",
      objective: "Add the smallest first-class auth gateway path for thread.start and record a safe auth summary on accepted sessions.",
      acceptanceCriteria: [
        "weave/auth exports core auth gateway interfaces and constructors.",
        "Identity providers and access controllers are separate swappable parts.",
        "POST /threads can be protected by authGateway(...).",
        "Denied thread.start requests do not create sessions.",
        "Accepted thread.start requests record principal id, provider, and source in safe session metadata.",
        "No raw access tokens, raw ID tokens, refresh tokens, or full provider claims are stored by default.",
        "Existing examples and tests can run with explicit anonymous or no-op auth behavior.",
      ],
      allowedFiles: [
        "src/",
        "docs/slices/51-auth-gateway-thread-start.md",
        "docs/slices/README.md",
        "docs/architecture.md",
        "docs/declarative-api.md",
        "docs/event-taxonomy.md",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
      ],
      constraints: [
        "Implement only docs/slices/51-auth-gateway-thread-start.md; do not run or edit auth slices 52 through 56.",
        "Do not add concrete Better Auth, Clerk, Okta, or OpenAuth SDK dependencies.",
        "Do not store raw access tokens, raw ID tokens, refresh tokens, or full provider claims.",
        "Do not merge, push, or open a real PR from this dry run.",
        "Keep current unauthenticated local behavior unless auth is explicitly configured.",
      ],
      requiredReviewers,
      riskNotes: [
        "Security-sensitive auth boundary change.",
        "Session start compatibility and replay behavior must remain stable.",
      ],
    },
  ],
});

const pool = createPool();

try {
  await migrate(pool, { reset: false });

  const engine = new PostgresThreadEngine(pool);
  const service = new ThreadService(engine);
  const observability = new PostgresObservabilitySink(pool);
  const app = createAuthGatewayDryRunApp(workspaceProvider, observability);
  const runtime = createWeaveRuntime({
    app,
    agentName: "weave.maintainer",
    engine,
    service,
    intervalMs: 50,
    runnerOwnerId: `auth-dry-runner-${process.pid}`,
    toolWorkerId: `auth-dry-tool-${process.pid}`,
  });

  runtime.runnerDaemon.start();
  runtime.toolDaemon.start();

  try {
    const session = await service.startSession({
      prompt: "Dry-run Auth Gateway slice 51 through Weave Maintainer.",
      source: "system",
      agentName: "weave.maintainer",
      actor: { type: "human", id: "dry-run-operator" },
      metadata: initiativeInput,
      idempotencyKey,
    });

    const liveEventCursor = new Map<string, number>();
    const firstStop = await waitForStop(engine, service, session.threadId, timeoutMs, liveEventCursor);
    const planGate = firstStop.gates.find((gate) => gate.reason === "slice-plan-approval");
    if (planGate && options.approvePlan) {
      await service.resolveGate(planGate.threadId, planGate.gateId, "approved", "Auth gateway slice 51 dry-run approval.");
      console.log(`approvedPlanGate=${planGate.gateId}`);
      const finalStop = await waitForStop(engine, service, session.threadId, timeoutMs, liveEventCursor);
      printDryRunSummary(session.threadId, finalStop);
    } else {
      printDryRunSummary(session.threadId, firstStop);
      if (planGate) {
        console.log(`planGate=${planGate.gateId}`);
        console.log("next=npm run auth:dry-run -- --approve-plan");
      }
    }
  } finally {
    await runtime.runnerDaemon.stop();
    await runtime.toolDaemon.stop();
  }
} finally {
  await pool.end();
}

function createAuthGatewayDryRunApp(workspaceProvider: WorkspaceProvider, observability: PostgresObservabilitySink) {
  const implementationAgent = createOpenCodeImplementerAgent({
    runner: createOpenCodeCliImplementationRunner({
      command: options.openCodeCommand ?? process.env.WEAVE_DRY_RUN_OPENCODE_COMMAND ?? "opencode",
      ...(options.openCodeArgs ? { args: options.openCodeArgs } : {}),
      timeoutMs,
      maxOutputBytes: 2_000_000,
    }),
  });
  const repairAgent = createRepairAgent({
    runner: createOpenCodeCliRepairRunner({
      command: options.openCodeCommand ?? process.env.WEAVE_DRY_RUN_OPENCODE_COMMAND ?? "opencode",
      ...(options.openCodeArgs ? { args: options.openCodeArgs } : {}),
      timeoutMs,
      maxOutputBytes: 2_000_000,
    }),
  });
  const verificationAgent = createVerificationAgent({ runner: createCommandVerificationRunner() });
  const reviewerRunner = createDeterministicReviewerRunner(workspaceProvider);
  const reviewerAgents = Object.fromEntries(
    requiredReviewers.map((reviewer) => [reviewer, createReviewerAgent({ reviewer, runner: reviewerRunner })]),
  );
  const sliceRunnerAgent = createSliceRunnerAgent({
    implementationAgent,
    verificationAgent,
    reviewerAgents,
    repairAgent,
  });
  const prAgent = createPrAgent();
  const maintainerAgent = createWeaveMaintainerAgent({
    sliceRunnerAgent,
    prAgent,
    workspaceProvider,
    github: { mode: "none", draft: true },
  });

  return defineWeaveApp({
    name: "auth-gateway-slice-51-dry-run",
    credentialProvider: new LocalDryRunCredentialProvider(),
    observability,
    agents: [
      maintainerAgent,
      sliceRunnerAgent,
      implementationAgent,
      verificationAgent,
      repairAgent,
      ...Object.values(reviewerAgents),
      prAgent,
    ],
  });
}

function createCommandVerificationRunner() {
  return {
    async run(input: VerificationAgentInput): Promise<VerificationResult> {
      const commands = input.commands ?? [
        { command: "npm", args: ["test"], required: true, timeoutMs: 120_000 },
        { command: "npm", args: ["run", "typecheck"], required: true, timeoutMs: 120_000 },
        { command: "git", args: ["diff", "--check"], required: true, timeoutMs: 120_000 },
      ];
      const results: DevCommandResult[] = [];

      for (const command of commands) {
        const startedAt = Date.now();
        const commandArgs = command.args ?? [];
        const commandRequired = command.required ?? true;
        const commandTimeoutMs = command.timeoutMs ?? 120_000;
        const result = await runVerificationCommand(input.workspaceRef.path, command.command, commandArgs, commandTimeoutMs, input.maxOutputBytes ?? 32_000);
        results.push({
          command: [command.command, ...commandArgs].join(" "),
          exitCode: result.exitCode,
          status: result.exitCode === 0 ? "passed" : commandRequired ? "failed" : "skipped",
          durationMs: Date.now() - startedAt,
          summary: result.exitCode === 0 ? "Command passed." : `Command failed with exit code ${result.exitCode ?? "unknown"}.`,
          ...(result.output ? { output: result.output } : {}),
        });
      }

      const failed = results.filter((result) => result.status === "failed");
      return {
        status: failed.length === 0 ? "passed" : "failed",
        commands: results,
        ...(failed.length > 0 ? { failureSummary: failed.map((result) => `${result.command}: ${result.summary}`).join("; ") } : {}),
      };
    },
  };
}

function createDeterministicReviewerRunner(workspaceProvider: WorkspaceProvider): ReviewerRunner {
  return {
    async run(input: ReviewerAgentInput) {
      const diff = await workspaceProvider.diff({ ref: input.workspaceRef, maxBytes: 128_000 });
      const findings: DevReviewFinding[] = [];
      if (diff.changedFiles.length === 0) {
        findings.push({ severity: "medium", issue: "Workspace diff is empty after implementation." });
      }

      if (input.reviewer === "docs-reviewer") {
        const docsChanged = diff.changedFiles.some((file) => file.endsWith(".md"));
        if (!docsChanged) {
          findings.push({
            severity: "low",
            file: "docs/slices/51-auth-gateway-thread-start.md",
            issue: "Auth gateway slice completion should update the slice docs or another relevant markdown document.",
            suggestedFix: "Update completion notes or architecture docs for the shipped auth gateway path.",
          });
        }
      }

      return {
        reviewer: input.reviewer,
        verdict: findings.length > 0 ? "needs-fixes" : "pass",
        findings,
        summary: `${input.reviewer} inspected ${diff.changedFiles.length} changed file(s) with deterministic dry-run checks.`,
      };
    },
  };
}

async function runVerificationCommand(
  cwd: string,
  command: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<{ exitCode: number | null; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], { cwd, timeout: timeoutMs, maxBuffer: maxOutputBytes });
    return { exitCode: 0, output: truncateOutput(`${String(stdout)}${String(stderr)}`, maxOutputBytes) };
  } catch (error) {
    const execError = error as Error & { code?: number | string | null; stdout?: string | Buffer; stderr?: string | Buffer };
    const exitCode = typeof execError.code === "number" ? execError.code : null;
    return {
      exitCode,
      output: truncateOutput(`${String(execError.stdout ?? "")}${String(execError.stderr ?? execError.message)}`, maxOutputBytes),
    };
  }
}

async function waitForStop(
  engine: PostgresThreadEngine,
  service: ThreadService,
  rootThreadId: string,
  timeoutMs: number,
  lastSeqByThread: Map<string, number> = new Map(),
): Promise<DryRunStop> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tree = await collectThreadTree(engine, service, rootThreadId);
    printNewThreadEvents(tree, lastSeqByThread);
    const reconciled = await reconcileTerminalChildren(service, tree);
    if (reconciled) {
      await sleep(250);
      continue;
    }
    const gates = await collectPendingGates(engine, tree);
    const root = tree.find((thread) => thread.threadId === rootThreadId);
    if (gates.length > 0 || (root && isThreadTerminal(root))) {
      return { tree, gates };
    }
    await sleep(250);
  }

  const tree = await collectThreadTree(engine, service, rootThreadId);
  const gates = await collectPendingGates(engine, tree);
  throw new Error(`Timed out after ${timeoutMs}ms waiting for dry-run progress. Threads=${tree.length} pendingGates=${gates.length}`);
}

function isThreadTerminal(thread: DryRunThread): boolean {
  return (
    thread.projection.status === "completed" ||
    thread.projection.status === "failed" ||
    thread.events.some((event) => event.type === "agent.response.produced" || event.type === "agent.failed")
  );
}

async function collectThreadTree(
  engine: PostgresThreadEngine,
  service: ThreadService,
  rootThreadId: string,
): Promise<DryRunThread[]> {
  const threads: DryRunThread[] = [];

  async function visit(threadId: string, depth: number): Promise<void> {
    const projection = await engine.getProjection(threadId);
    if (!projection) {
      return;
    }
    const events = await engine.read(threadId);
    const started = events.find((event) => event.type === "session.started");
    threads.push({ threadId, depth, projection, events, agentName: started?.payload.agentName });
    const children = await service.listChildren(threadId, { includeDetached: true });
    for (const child of children) {
      await visit(child.threadId, depth + 1);
    }
  }

  await visit(rootThreadId, 0);
  return threads;
}

async function collectPendingGates(engine: PostgresThreadEngine, tree: readonly DryRunThread[]): Promise<PendingGate[]> {
  const gates: PendingGate[] = [];
  for (const thread of tree) {
    if (thread.projection.pendingGateIds.length === 0) {
      continue;
    }
    const events = thread.events.length > 0 ? thread.events : await engine.read(thread.threadId);
    for (const gateId of thread.projection.pendingGateIds) {
      const created = events.find((event) => event.type === "gate.created" && event.payload.gateId === gateId);
      if (created?.type === "gate.created") {
        gates.push({
          threadId: thread.threadId,
          gateId,
          agentName: thread.agentName,
          reason: created.payload.reason,
          proposedAction: created.payload.proposedAction,
        });
      }
    }
  }
  return gates;
}

function printDryRunSummary(rootThreadId: string, stop: DryRunStop): void {
  console.log(`rootThreadId=${rootThreadId}`);
  console.log(`baseBranch=${baseBranch}`);
  console.log(`workingBranch=${workingBranch}`);
  console.log(`workspaceRoot=${workspaceRoot}`);
  console.log(`idempotencyKey=${idempotencyKey}`);
  console.log("threads:");
  for (const thread of stop.tree) {
    console.log(`${"  ".repeat(thread.depth)}- ${thread.threadId} agent=${thread.agentName ?? "unknown"} status=${thread.projection.status} tailSeq=${thread.projection.tailSeq}`);
  }
  if (stop.gates.length > 0) {
    console.log("pendingGates:");
    for (const gate of stop.gates) {
      console.log(`- thread=${gate.threadId} gate=${gate.gateId} reason=${gate.reason} action=${gate.proposedAction ?? ""}`);
    }
  }
  console.log("rootTimeline:");
  const root = stop.tree.find((thread) => thread.threadId === rootThreadId);
  console.log(root ? toTextTimeline(root.events) : "missing root thread");
}

function printNewThreadEvents(tree: readonly DryRunThread[], lastSeqByThread: Map<string, number>): void {
  for (const thread of tree) {
    const previousSeq = lastSeqByThread.get(thread.threadId) ?? -1;
    const nextEvents = thread.events.filter((event) => (event.seq ?? -1) > previousSeq && shouldPrintLiveEvent(event));
    for (const event of nextEvents) {
      console.log(`[${thread.agentName ?? "unknown"} ${thread.threadId.slice(0, 8)} #${event.seq}] ${event.type}${eventSummary(event)}`);
    }
    const lastSeq = thread.events.at(-1)?.seq;
    if (lastSeq !== undefined) {
      lastSeqByThread.set(thread.threadId, lastSeq);
    }
  }
}

function shouldPrintLiveEvent(event: ThreadEvent): boolean {
  return [
    "tool.started",
    "tool.progress",
    "tool.completed",
    "tool.failed",
    "child_thread.spawned",
    "child_thread.completed",
    "child_thread.failed",
    "gate.created",
    "agent.failed",
    "agent.response.produced",
    "dev.slice.started",
    "dev.slice.completed",
    "dev.slice.failed",
    "dev.implementation.started",
    "dev.implementation.completed",
    "dev.verification.completed",
    "dev.review.completed",
    "dev.repair.started",
    "dev.repair.completed",
    "dev.pr.ready_for_review",
  ].includes(event.type);
}

function eventSummary(event: ThreadEvent): string {
  if (event.type === "tool.progress") {
    return ` ${event.payload.percent}% ${event.payload.message}`;
  }
  if (event.type === "tool.failed") {
    return ` ${event.payload.errorCode}: ${event.payload.message}`;
  }
  if (event.type === "tool.completed") {
    return event.payload.summary ? ` ${event.payload.summary}` : "";
  }
  if (event.type === "gate.created") {
    return ` ${event.payload.reason}: ${event.payload.proposedAction ?? ""}`;
  }
  if (event.type === "child_thread.spawned") {
    return ` ${event.payload.childAgentName} ${event.payload.childThreadId}`;
  }
  if (event.type === "child_thread.failed") {
    return ` ${event.payload.errorCode}: ${event.payload.message}`;
  }
  if (event.type === "agent.failed") {
    return ` ${event.payload.errorCode}: ${event.payload.message}`;
  }
  const payload = event.payload as Record<string, unknown>;
  return typeof payload.summary === "string" ? ` ${payload.summary}` : "";
}

async function reconcileTerminalChildren(service: ThreadService, tree: readonly DryRunThread[]): Promise<boolean> {
  let reconciled = false;
  for (const thread of tree) {
    const { projection } = thread;
    if (!projection.parentThreadId || !projection.parentScopeKey || !projection.parentStepKey) {
      continue;
    }
    if (projection.status !== "completed" && projection.status !== "failed") {
      continue;
    }
    const parent = tree.find((candidate) => candidate.threadId === projection.parentThreadId);
    if (parent && hasMirroredChildTerminal(parent.events, projection.threadId, projection.parentScopeKey, projection.parentStepKey)) {
      continue;
    }
    await service.mirrorChildTerminalEvent({
      parentThreadId: projection.parentThreadId,
      childThreadId: projection.threadId,
      childAgentName: thread.agentName,
      parentScopeKey: projection.parentScopeKey,
      parentStepKey: projection.parentStepKey,
    });
    reconciled = true;
  }
  return reconciled;
}

function hasMirroredChildTerminal(
  events: readonly ThreadEvent[],
  childThreadId: string,
  parentScopeKey: string,
  parentStepKey: string,
): boolean {
  return events.some((event) => {
    return (
      (event.type === "child_thread.completed" || event.type === "child_thread.failed") &&
      event.payload.childThreadId === childThreadId &&
      event.scopeKey === parentScopeKey &&
      event.stepKey === parentStepKey
    );
  });
}

async function currentGitBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
  const branch = String(stdout).trim();
  if (!branch) {
    throw new Error("Current checkout is detached; pass --base-branch explicitly from a branch checkout.");
  }
  return branch;
}

function parseOptions(args: readonly string[]): DryRunOptions {
  const parsed: DryRunOptions = { approvePlan: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--approve-plan") {
      parsed.approvePlan = true;
      continue;
    }
    if (arg === "--base-branch") {
      parsed.baseBranch = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--working-branch") {
      parsed.workingBranch = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--workspace-root") {
      parsed.workspaceRoot = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--idempotency-key") {
      parsed.idempotencyKey = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(requiredValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--opencode-command") {
      parsed.openCodeCommand = requiredValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--opencode-args") {
      parsed.openCodeArgs = requiredValue(args, index, arg).split(" ").filter(Boolean);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (parsed.timeoutMs !== undefined && (!Number.isInteger(parsed.timeoutMs) || parsed.timeoutMs <= 0)) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  return parsed;
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function truncateOutput(output: string, maxBytes: number): string {
  const buffer = Buffer.from(output, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return output;
  }
  return `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated at ${maxBytes} bytes]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type DryRunOptions = {
  approvePlan: boolean;
  baseBranch?: string;
  workingBranch?: string;
  workspaceRoot?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  openCodeCommand?: string;
  openCodeArgs?: string[];
};

type DryRunThread = {
  threadId: string;
  depth: number;
  projection: ThreadProjection;
  events: ThreadEvent[];
  agentName?: string;
};

type PendingGate = {
  threadId: string;
  gateId: string;
  agentName?: string;
  reason: string;
  proposedAction?: string;
};

type DryRunStop = {
  tree: DryRunThread[];
  gates: PendingGate[];
};
