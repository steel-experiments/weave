import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineWeaveApp } from "../app-contract.js";
import type { CredentialProvider, CredentialRequest, CredentialResolution, CredentialResolutionContext } from "../credentials.js";
import { createPool } from "../db.js";
import {
  createMarkdownInitiativePlanCompiler,
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
import { buildInitiativeRunInput, parseInitiativeRunOptions } from "../development-initiative-runner.js";
import { formatInitiativeStatus, getInitiativeStatus } from "../development-operator.js";
import type { DevCommandResult, DevReviewFinding, ThreadEvent, ThreadProjection } from "../events.js";
import { migrate } from "../migrate.js";
import { createOpenCodeCliImplementationRunner, createOpenCodeCliRepairRunner } from "../opencode-runner.js";
import { PostgresObservabilitySink } from "../postgres-observability.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
import { createWeaveRuntime } from "../runtime.js";
import { ThreadService } from "../thread-service.js";
import { GitWorktreeWorkspaceProvider, type WorkspaceProvider } from "../workspace-provider.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const options = parseInitiativeRunOptions(process.argv.slice(2));
const baseBranch = options.baseBranch ?? (await currentGitBranch(repoRoot));
const timeoutMs = options.timeoutMs;
const workspaceProvider = new GitWorktreeWorkspaceProvider();
const reviewerRoles = [
  "architecture-reviewer",
  "replay-safety-reviewer",
  "compatibility-reviewer",
  "docs-reviewer",
  "security-reviewer",
] satisfies DevelopmentReviewerRole[];

class InitiativeRunCredentialProvider implements CredentialProvider {
  async resolve(request: CredentialRequest, context: CredentialResolutionContext): Promise<CredentialResolution> {
    return {
      name: request.name,
      kind: request.kind,
      source: "initiative-run",
      subject: context.toolName,
    };
  }
}

const { initiativeInput, idempotencyKey, prdPath } = await buildInitiativeRunInput({ options, repoRoot, baseBranch });
const pool = createPool();

try {
  await migrate(pool, { reset: false });
  const engine = new PostgresThreadEngine(pool);
  const service = new ThreadService(engine);
  const observability = new PostgresObservabilitySink(pool);
  const app = createInitiativeRunApp(workspaceProvider, observability);
  const runtime = createWeaveRuntime({
    app,
    agentName: "weave.maintainer",
    engine,
    service,
    intervalMs: 50,
    runnerOwnerId: `initiative-runner-${process.pid}`,
    toolWorkerId: `initiative-tool-${process.pid}`,
  });

  runtime.runnerDaemon.start();
  runtime.toolDaemon.start();

  try {
    const session = await service.startSession({
      prompt: `Run PRD-backed initiative from ${prdPath}.`,
      source: "system",
      agentName: "weave.maintainer",
      actor: { type: "human", id: "initiative-operator" },
      metadata: initiativeInput,
      idempotencyKey,
    });

    console.log(`rootThreadId=${session.threadId}`);
    console.log(`prd=${prdPath}`);
    console.log(`baseBranch=${initiativeInput.baseBranch}`);
    console.log(`workingBranch=${initiativeInput.workingBranch}`);
    console.log(`idempotencyKey=${idempotencyKey}`);

    const stop = await waitForStop(engine, service, session.threadId, timeoutMs);
    const status = await getInitiativeStatus(pool, session.threadId);
    if (status) {
      console.log("");
      console.log(formatInitiativeStatus(status));
    }
    if (stop.gates.length > 0) {
      console.log("");
      console.log("Pending gates:");
      for (const gate of stop.gates) {
        console.log(`- ${gate.gateId} thread=${gate.threadId} reason=${gate.reason} action=${gate.proposedAction ?? ""}`);
      }
      console.log("");
      console.log(`Next: npm run gates:show -- ${stop.gates[0]?.gateId}`);
      console.log(`Then: npm run initiative:run -- --from ${options.from} --idempotency-key ${idempotencyKey}`);
    } else {
      const root = stop.tree.find((thread) => thread.threadId === session.threadId);
      console.log("");
      console.log(`Initiative stopped with root status ${root?.projection.status ?? "unknown"}.`);
    }
  } finally {
    await runtime.runnerDaemon.stop();
    await runtime.toolDaemon.stop();
  }
} finally {
  await pool.end();
}

function createInitiativeRunApp(workspaceProvider: WorkspaceProvider, observability: PostgresObservabilitySink) {
  const implementationAgent = createOpenCodeImplementerAgent({
    runner: createOpenCodeCliImplementationRunner({
      command: options.openCodeCommand ?? process.env.WEAVE_INITIATIVE_OPENCODE_COMMAND ?? "opencode",
      ...(options.openCodeArgs ? { args: options.openCodeArgs } : {}),
      timeoutMs,
      maxOutputBytes: 2_000_000,
    }),
  });
  const repairAgent = createRepairAgent({
    runner: createOpenCodeCliRepairRunner({
      command: options.openCodeCommand ?? process.env.WEAVE_INITIATIVE_OPENCODE_COMMAND ?? "opencode",
      ...(options.openCodeArgs ? { args: options.openCodeArgs } : {}),
      timeoutMs,
      maxOutputBytes: 2_000_000,
    }),
  });
  const verificationAgent = createVerificationAgent({ runner: createCommandVerificationRunner() });
  const reviewerRunner = createDeterministicReviewerRunner(workspaceProvider);
  const reviewerAgents = Object.fromEntries(reviewerRoles.map((reviewer) => [reviewer, createReviewerAgent({ reviewer, runner: reviewerRunner })]));
  const sliceRunnerAgent = createSliceRunnerAgent({ implementationAgent, verificationAgent, reviewerAgents, repairAgent });
  const prAgent = createPrAgent();
  const maintainerAgent = createWeaveMaintainerAgent({
    planCompiler: createMarkdownInitiativePlanCompiler({ defaultReviewers: ["architecture-reviewer"] }),
    sliceRunnerAgent,
    prAgent,
    workspaceProvider,
    github: { mode: "none", draft: true },
  });

  return defineWeaveApp({
    name: "initiative-run",
    credentialProvider: new InitiativeRunCredentialProvider(),
    observability,
    agents: [maintainerAgent, sliceRunnerAgent, implementationAgent, verificationAgent, repairAgent, ...Object.values(reviewerAgents), prAgent],
  });
}

function createCommandVerificationRunner() {
  return {
    async run(input: VerificationAgentInput): Promise<VerificationResult> {
      const results: DevCommandResult[] = [];
      for (const command of input.commands ?? []) {
        const startedAt = Date.now();
        const commandArgs = command.args ?? [];
        const result = await runVerificationCommand(input.workspaceRef.path, command.command, commandArgs, command.timeoutMs ?? 120_000, input.maxOutputBytes ?? 32_000);
        results.push({
          command: [command.command, ...commandArgs].join(" "),
          exitCode: result.exitCode,
          status: result.exitCode === 0 ? "passed" : command.required === false ? "skipped" : "failed",
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
      return {
        reviewer: input.reviewer,
        verdict: findings.length > 0 ? "needs-fixes" : "pass",
        findings,
        summary: `${input.reviewer} inspected ${diff.changedFiles.length} changed file(s).`,
      };
    },
  };
}

async function waitForStop(engine: PostgresThreadEngine, service: ThreadService, rootThreadId: string, timeoutMs: number): Promise<InitiativeRunStop> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tree = await collectThreadTree(engine, service, rootThreadId);
    const reconciled = await reconcileTerminalChildren(service, tree);
    if (reconciled) {
      await sleep(250);
      continue;
    }
    const gates = collectPendingGates(tree);
    const root = tree.find((thread) => thread.threadId === rootThreadId);
    if (gates.length > 0 || (root && isThreadTerminal(root))) {
      return { tree, gates };
    }
    await sleep(250);
  }
  const tree = await collectThreadTree(engine, service, rootThreadId);
  throw new Error(`Timed out after ${timeoutMs}ms waiting for initiative progress. Threads=${tree.length}`);
}

async function collectThreadTree(engine: PostgresThreadEngine, service: ThreadService, rootThreadId: string): Promise<InitiativeRunThread[]> {
  const threads: InitiativeRunThread[] = [];
  async function visit(threadId: string, depth: number): Promise<void> {
    const projection = await engine.getProjection(threadId);
    if (!projection) {
      return;
    }
    const events = await engine.read(threadId);
    const started = events.find((event) => event.type === "session.started");
    threads.push({ threadId, depth, projection, events, agentName: started?.payload.agentName });
    for (const child of await service.listChildren(threadId, { includeDetached: true })) {
      await visit(child.threadId, depth + 1);
    }
  }
  await visit(rootThreadId, 0);
  return threads;
}

function collectPendingGates(tree: readonly InitiativeRunThread[]): PendingGate[] {
  return tree.flatMap((thread) =>
    thread.projection.pendingGateIds.flatMap((gateId) => {
      const created = thread.events.find((event) => event.type === "gate.created" && event.payload.gateId === gateId);
      return created?.type === "gate.created"
        ? [{ threadId: thread.threadId, gateId, reason: created.payload.reason, proposedAction: created.payload.proposedAction }]
        : [];
    }),
  );
}

function isThreadTerminal(thread: InitiativeRunThread): boolean {
  return thread.projection.status === "completed" || thread.projection.status === "failed" || thread.events.some((event) => event.type === "agent.response.produced" || event.type === "agent.failed");
}

async function reconcileTerminalChildren(service: ThreadService, tree: readonly InitiativeRunThread[]): Promise<boolean> {
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
    if (parent?.events.some((event) => (event.type === "child_thread.completed" || event.type === "child_thread.failed") && event.payload.childThreadId === projection.threadId && event.scopeKey === projection.parentScopeKey && event.stepKey === projection.parentStepKey)) {
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

async function runVerificationCommand(cwd: string, command: string, args: readonly string[], timeout: number, maxOutputBytes: number): Promise<{ exitCode: number | null; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], { cwd, timeout, maxBuffer: maxOutputBytes });
    return { exitCode: 0, output: truncateOutput(`${String(stdout)}${String(stderr)}`, maxOutputBytes) };
  } catch (error) {
    const execError = error as Error & { code?: number | string | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      exitCode: typeof execError.code === "number" ? execError.code : null,
      output: truncateOutput(`${String(execError.stdout ?? "")}${String(execError.stderr ?? execError.message)}`, maxOutputBytes),
    };
  }
}

async function currentGitBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
  const branch = String(stdout).trim();
  if (!branch) {
    throw new Error("Current checkout is detached; pass --base-branch explicitly from a branch checkout.");
  }
  return branch;
}

function truncateOutput(output: string, maxBytes: number): string {
  const buffer = Buffer.from(output, "utf8");
  return buffer.byteLength <= maxBytes ? output : `${buffer.subarray(0, maxBytes).toString("utf8")}\n[truncated at ${maxBytes} bytes]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type InitiativeRunThread = {
  threadId: string;
  depth: number;
  projection: ThreadProjection;
  events: ThreadEvent[];
  agentName?: string;
};

type PendingGate = {
  threadId: string;
  gateId: string;
  reason: string;
  proposedAction?: string;
};

type InitiativeRunStop = {
  tree: InitiativeRunThread[];
  gates: PendingGate[];
};
