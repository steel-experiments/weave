import {
  agent,
  deterministicUuid,
  domainEvent,
  event,
  eventKey,
  nowIso,
  policy,
  stableJsonHash,
  weave,
  type AppendOptions,
  type AppendResult,
  type CreateThreadOptions,
  type FollowCursor,
  type Lease,
  type ReadOptions,
  type ThreadEngine,
  type ThreadEvent,
  type ThreadLeaseStore,
  type ThreadProjection,
} from "weave";
import { ContractToolWorker, ThreadRunner, ThreadService, createRuntimeAgentPlanner } from "weave/runtime";
import {
  ClaimCheckInputSchema,
  ClaimCheckOutputSchema,
  ClaimExtractionInputSchema,
  ClaimExtractionOutputSchema,
  ClaimVerificationInputSchema,
  ClaimVerificationOutputSchema,
  FinalReportSchema,
  SynthesisInputSchema,
  WorkflowInputSchema,
  WorkflowPlanSchema,
  type ClaimCheckInput,
  type ClaimCheckOutput,
  type ClaimVerificationOutput,
  type ExtractedClaim,
  type FinalReport,
  type WorkflowInput,
  type WorkflowPlan,
} from "./schemas.js";
import {
  compileWorkflowPlanWithCompiler,
  normalizeWorkflowPlan,
  type WorkflowCompiler,
} from "./workflow-compiler.js";
import {
  createOpenCodeAgent,
  repoReadCapability,
  repoReadFileTool,
  repoListFilesTool,
  repoReadRangeTool,
  repoSearchTextTool,
  workflowCapabilityDecision,
  type OpenCodeSessionRunner,
  type RepoSearchTextOutput,
} from "./opencode-adapter.js";
import { FINDING_PRODUCED, FindingProducedSchema } from "./events.js";

const SAFE_CAPABILITIES = new Set(["repo.read"]);
const REGISTERED_WORKFLOW_AGENT_NAMES = new Set([
  "workflow.claimExtractor",
  "workflow.claimChecker",
  "workflow.claimVerifier",
  "workflow.synthesizer",
]);

export const deterministicWorkflowCompiler: WorkflowCompiler = {
  source: "deterministic",
  compile(input) {
    return deterministicWorkflowPlan(input);
  },
};

let activeWorkflowCompiler: WorkflowCompiler = deterministicWorkflowCompiler;
let activeClaimCheckRunner: OpenCodeSessionRunner<ClaimCheckInput>;

export const claimExtractorAgent = agent({
  name: "workflow.claimExtractor",
  input: ClaimExtractionInputSchema,
  output: ClaimExtractionOutputSchema,
  run(_ctx, input) {
    return { claims: extractClaims(input.document) };
  },
});

const defaultClaimCheckRunner: OpenCodeSessionRunner<ClaimCheckInput> = {
  async run({ input, tools }) {
    const search = await tools.searchText({ query: input.claim.text, maxResults: 10 });
    const primaryEvidence = search.matches[0];
    if (primaryEvidence) {
      await tools.readRange({ path: primaryEvidence.path, startLine: primaryEvidence.line, endLine: primaryEvidence.line });
    }
    const evidence = classifyClaimEvidence(input.claim.text, search);
    return {
      claim: input.claim.text,
      status: evidence.status,
      confidence: evidence.confidence,
      evidence: evidence.evidence,
      checkerNotes: evidence.notes,
    };
  },
};

activeClaimCheckRunner = defaultClaimCheckRunner;

export const claimCheckerAgent = createOpenCodeAgent({
  name: "workflow.claimChecker",
  description: "Bounded OpenCode claim checker using mediated read-only repository tools.",
  input: ClaimCheckInputSchema,
  output: ClaimCheckOutputSchema,
  limits: {
    maxToolCalls: 4,
    timeoutMs: 120_000,
    maxBytesRead: 1_000_000,
    maxOutputBytes: 50_000,
    maxFileSizeBytes: 200_000,
  },
  taskPrompt(input) {
    return `Check this claim against the repository using read-only tools, then return structured JSON only: ${input.claim.text}`;
  },
  runner: {
    run(session) {
      return activeClaimCheckRunner.run(session);
    },
  },
});

export const claimVerifierAgent = agent({
  name: "workflow.claimVerifier",
  input: ClaimVerificationInputSchema,
  output: ClaimVerificationOutputSchema,
  run(_ctx, input) {
    const weakEvidence = input.check.evidence.length === 0 || input.check.confidence < 0.75;
    return {
      claim: input.check.claim,
      verifierNotes: weakEvidence
        ? "Adversarial review found weak or missing repository evidence. Keep this claim out of the publish path."
        : "Adversarial review found the cited repository evidence sufficient for this example.",
      confidenceAdjustment: weakEvidence ? -0.15 : 0,
    };
  },
});

export const synthesizerAgent = agent({
  name: "workflow.synthesizer",
  input: SynthesisInputSchema,
  output: FinalReportSchema,
  run(_ctx, input) {
    return synthesizeReport(input.objective, input.checks, input.verifications);
  },
});

export const workflowCustomizeAgent = agent({
  name: "workflow.customize",
  input: WorkflowInputSchema,
  output: FinalReportSchema,
  async run(ctx, input) {
    const plan = await ctx.checkpoint("workflow-plan", () =>
      compileWorkflowPlanWithCompiler(input, activeWorkflowCompiler, workflowPlanValidationOptions()),
    );
    await ctx.emit(
      "workflow-plan-summary",
      domainEvent(FINDING_PRODUCED, FindingProducedSchema, {
        findingId: ctx.id("workflow-plan-summary"),
        severity: planRequiresApproval(plan) ? "warning" : "info",
        summary: `Workflow plan selected ${plan.pattern} with ${plan.steps.length} deterministic steps.`,
        evidence: plan.requiredCapabilities.map((capability) => ({
          source: `capability:${capability.name}`,
          summary: capability.reason,
        })),
      }),
    );

    if (planRequiresApproval(plan)) {
      await ctx.gate("approve-expanded-capabilities", {
        reason: "risky-remediation",
        proposedAction: `Approve workflow capabilities: ${plan.requiredCapabilities.map((capability) => capability.name).join(", ")}`,
      });
    }

    const extractionRef = await ctx.spawn("extract-claims", claimExtractorAgent, { document: input.document });
    const extraction = await ctx.join("join-extract-claims", extractionRef, { throwOnFailure: true });
    if (extraction.status !== "completed" || !extraction.output) {
      throw new Error("Claim extraction did not complete.");
    }

    const checks: ClaimCheckOutput[] = [];
    for (const claim of extraction.output.claims) {
      const checkRef = await ctx.spawn(`check:${claim.key}`, claimCheckerAgent, { claim });
      const check = await ctx.join(`join-check:${claim.key}`, checkRef, { throwOnFailure: true });
      if (check.status !== "completed" || !check.output) {
        throw new Error(`Claim check did not complete: ${claim.key}`);
      }
      checks.push(check.output);
    }

    const verifications: ClaimVerificationOutput[] = [];
    for (const check of checks.filter((candidate) => candidate.confidence < 0.8 || candidate.status !== "verified")) {
      const verifyKey = claimKey(check.claim);
      const verifierRef = await ctx.spawn(`verify:${verifyKey}`, claimVerifierAgent, { check });
      const verification = await ctx.join(`join-verify:${verifyKey}`, verifierRef, { throwOnFailure: true });
      if (verification.status !== "completed" || !verification.output) {
        throw new Error(`Claim verification did not complete: ${verifyKey}`);
      }
      verifications.push(verification.output);
    }

    const synthRef = await ctx.spawn("synthesize-report", synthesizerAgent, {
      objective: plan.objective,
      checks,
      verifications,
    });
    const report = await ctx.join("join-synthesize-report", synthRef, { throwOnFailure: true });
    if (report.status !== "completed" || !report.output) {
      throw new Error("Workflow synthesis did not complete.");
    }
    return report.output;
  },
});

export const promptWorkflowReviewApp = weave({
  name: "prompt-workflow-review",
  agents: [workflowCustomizeAgent, claimExtractorAgent, claimCheckerAgent, claimVerifierAgent, synthesizerAgent],
  tools: [repoListFilesTool, repoSearchTextTool, repoReadFileTool, repoReadRangeTool],
  policies: [
    policy({
      name: "prompt-workflow.repo-read-only",
      evaluate(request) {
        const capabilityNames = request.capabilities.map((capability) => capability.name);
        const decision = workflowCapabilityDecision(capabilityNames);
        if (decision === "deny") {
          return { outcome: "deny", reason: `Unsupported workflow capability: ${capabilityNames.join(", ")}` };
        }
        return decision === "allow" ? { outcome: "allow", reason: "Repository reads are allowed for claim checking." } : undefined;
      },
    }),
  ],
});

export type PromptWorkflowDemoResult = {
  threadId: string;
  report: FinalReport;
  events: ThreadEvent[];
  allEvents: ThreadEvent[];
  childThreadIds: string[];
};

export type PromptWorkflowReviewDemoOptions = {
  compiler?: WorkflowCompiler;
  claimCheckRunner?: OpenCodeSessionRunner<ClaimCheckInput>;
};

export async function runPromptWorkflowReviewDemo(
  input: WorkflowInput = defaultWorkflowInput(),
  options: PromptWorkflowReviewDemoOptions = {},
): Promise<PromptWorkflowDemoResult> {
  const previousWorkflowCompiler = activeWorkflowCompiler;
  const previousClaimCheckRunner = activeClaimCheckRunner;
  activeWorkflowCompiler = options.compiler ?? deterministicWorkflowCompiler;
  activeClaimCheckRunner = options.claimCheckRunner ?? defaultClaimCheckRunner;
  try {
    const engine = new DemoThreadEngine();
    const service = new ThreadService(engine);
    const runner = new ThreadRunner(
      engine,
      engine,
      createRuntimeAgentPlanner(promptWorkflowReviewApp, workflowCustomizeAgent.name, service),
      "prompt-workflow-runner",
    );
    const toolWorker = new ContractToolWorker(
      engine,
      [repoListFilesTool, repoSearchTextTool, repoReadFileTool, repoReadRangeTool],
      "prompt-workflow-tool-worker",
    );
    const session = await service.startSession({
      prompt: input.prompt,
      agentName: workflowCustomizeAgent.name,
      metadata: input,
      idempotencyKey: "prompt-workflow-review-demo",
    });

    await drainWorkflow(engine, runner, toolWorker, session.threadId);

    const events = await engine.read(session.threadId);
    const output = [...events].reverse().find((event): event is Extract<ThreadEvent, { type: "agent.output.completed" }> => {
      return event.type === "agent.output.completed";
    });
    if (!output) {
      const projection = await engine.getProjection(session.threadId);
      const failures = events
        .filter((event) => event.type === "agent.failed" || event.type === "child_thread.failed")
        .map((event) => JSON.stringify(event.payload))
        .join(";");
      throw new Error(
        `Workflow did not produce a final report. status=${projection?.status ?? "missing"} failures=${failures} events=${events.map((event) => event.type).join(",")}`,
      );
    }

    return {
      threadId: session.threadId,
      report: FinalReportSchema.parse(output.payload.output),
      events,
      allEvents: engine.allEvents(),
      childThreadIds: events
        .filter((event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned")
        .map((event) => event.payload.childThreadId),
    };
  } finally {
    activeWorkflowCompiler = previousWorkflowCompiler;
    activeClaimCheckRunner = previousClaimCheckRunner;
  }
}

export function compileWorkflowPlan(input: WorkflowInput): WorkflowPlan {
  return normalizeWorkflowPlan(deterministicWorkflowPlan(input), workflowPlanValidationOptions());
}

export async function compileWorkflowPlanFromCompiler(
  input: WorkflowInput,
  compiler: WorkflowCompiler,
  unsafeCapabilityMode: "allow-for-gate" | "reject" = "allow-for-gate",
): Promise<WorkflowPlan> {
  return compileWorkflowPlanWithCompiler(input, compiler, workflowPlanValidationOptions(unsafeCapabilityMode));
}

export function workflowPlanValidationOptions(unsafeCapabilityMode: "allow-for-gate" | "reject" = "allow-for-gate") {
  return {
    registeredAgents: REGISTERED_WORKFLOW_AGENT_NAMES,
    safeCapabilities: SAFE_CAPABILITIES,
    unsafeCapabilityMode,
  };
}

function deterministicWorkflowPlan(input: WorkflowInput): WorkflowPlan {
  const claims = extractClaims(input.document);
  const requestedCapabilities = [
    { name: "repo.read", reason: "Claim checkers need read-only repository evidence." },
    ...(input.prompt.toLowerCase().includes("network")
      ? [{ name: "network.access", reason: "The prompt asked to verify citations against external network sources." }]
      : []),
    ...(input.prompt.toLowerCase().includes("write")
      ? [{ name: "repo.write", reason: "The prompt asked for repository mutation, which this example does not run silently." }]
      : []),
  ];
  return WorkflowPlanSchema.parse({
    objective: input.prompt,
    pattern: claims.some((claim) => claim.impact === "high") ? "adversarial-verification" : "fan-out-and-synthesize",
    budget: {
      maxChildAgents: Math.max(4, claims.length * 2 + 2),
      maxDepth: 2,
      maxToolCalls: claims.length,
    },
    requiredCapabilities: requestedCapabilities,
    steps: [
      { kind: "spawn", key: "extract-claims", agentName: claimExtractorAgent.name, input: { document: "<thread input document>" } },
      ...claims.map((claim) => ({
        kind: "spawn" as const,
        key: `check:${claim.key}`,
        agentName: claimCheckerAgent.name,
        input: { claim },
        verifyWith: claim.impact === "high" ? claimVerifierAgent.name : undefined,
      })),
      { kind: "synthesize", key: "synthesize-report", inputKeys: claims.map((claim) => `join-check:${claim.key}`) },
    ],
  });
}

export function planRequiresApproval(plan: WorkflowPlan): boolean {
  return plan.requiredCapabilities.some((capability) => !SAFE_CAPABILITIES.has(capability.name));
}

export function extractClaims(document: string): ExtractedClaim[] {
  const claimLines = document
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(-\s*)?(claim|assertion)\s*:/i.test(line))
    .map((line) => line.replace(/^(-\s*)?(claim|assertion)\s*:\s*/i, ""));
  const rawClaims = claimLines.length > 0 ? claimLines : fallbackClaims(document);
  return rawClaims.map((text) => ({
    key: claimKey(text),
    text,
    impact: /policy|approval|safety|credential|root thread|lineage/i.test(text) ? "high" : "medium",
  }));
}

export function claimKey(claim: string): string {
  const slug = claim
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return `${slug || "claim"}-${deterministicUuid("claim-key", claim).slice(0, 8)}`;
}

export function defaultWorkflowInput(): WorkflowInput {
  return {
    prompt:
      "Create a workflow to review this draft. Verify technical claims against the repository, fan out checks by claim, adversarially review weak evidence, and return a publish recommendation.",
    document: [
      "Claim: Weave child threads preserve root thread lineage across nested descendants.",
      "Claim: Request policies can require approval before risky tool execution proceeds.",
      "Claim: Weave currently executes arbitrary generated JavaScript workflow harnesses by default.",
    ].join("\n"),
  };
}

function classifyClaimEvidence(claim: string, search: RepoSearchTextOutput) {
  const normalized = claim.toLowerCase();
  if (normalized.includes("child threads") || normalized.includes("lineage")) {
    return {
      status: "verified" as const,
      confidence: 0.91,
      evidence: evidenceReferences(search),
      notes: "Repository docs and service code support child lineage preservation.",
    };
  }
  if (normalized.includes("policies") || normalized.includes("approval")) {
    return {
      status: "verified" as const,
      confidence: 0.86,
      evidence: evidenceReferences(search),
      notes: "Policy approval behavior is implemented in the request planning path.",
    };
  }
  if (normalized.includes("generated javascript")) {
    return {
      status: "unsupported" as const,
      confidence: 0.22,
      evidence: [],
      notes: "The prompt workflow slice explicitly avoids executing arbitrary model-generated JavaScript.",
    };
  }
  return {
    status: "needs-review" as const,
    confidence: 0.5,
    evidence: [],
    notes: "No matching repository evidence was found in the deterministic demo catalog.",
  };
}

function evidenceReferences(search: RepoSearchTextOutput): string[] {
  const references = search.matches.slice(0, 2).map((match) => `${match.path}:${match.line} ${match.text}`);
  return references.length > 0 ? references : ["repo.searchText: no direct line match found in demo catalog"];
}

function synthesizeReport(
  objective: string,
  checks: ClaimCheckOutput[],
  verifications: ClaimVerificationOutput[],
): FinalReport {
  const verificationByClaim = new Map(verifications.map((verification) => [verification.claim, verification]));
  const claims = checks.map((check) => {
    const verification = verificationByClaim.get(check.claim);
    const confidence = clamp(check.confidence + (verification?.confidenceAdjustment ?? 0));
    return {
      claim: check.claim,
      status: check.status,
      confidence,
      evidence: check.evidence,
      ...(verification ? { verifierNotes: verification.verifierNotes } : {}),
    };
  });
  const unsupported = claims.filter((claim) => claim.status === "unsupported").length;
  const needsReview = claims.filter((claim) => claim.status === "needs-review" || claim.confidence < 0.75).length;
  const recommendation = unsupported > 0 ? "do-not-publish" : needsReview > 0 ? "revise" : "publish";
  return FinalReportSchema.parse({
    recommendation,
    summary: `${objective} Result: ${claims.length} claims checked, ${unsupported} unsupported, ${needsReview} need review.`,
    claims,
  });
}

function fallbackClaims(document: string): string[] {
  const firstSentence = document.split(/[.!?]/).map((part) => part.trim()).find(Boolean);
  return [firstSentence ?? "The document contains a technical claim that should be checked against the repository."];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

async function drainWorkflow(
  engine: DemoThreadEngine,
  runner: ThreadRunner,
  toolWorker: ContractToolWorker,
  rootThreadId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let acted = false;
    for (const threadId of engine.threadIds()) {
      acted = (await drainTools(toolWorker, threadId)) || acted;
      const projection = await engine.getProjection(threadId);
      if (projection && projection.status !== "completed" && projection.status !== "failed" && projection.status !== "blocked") {
        const result = await runner.runOnce(threadId);
        acted = result.acted || acted;
      }
      acted = (await drainTools(toolWorker, threadId)) || acted;
    }

    const rootProjection = await engine.getProjection(rootThreadId);
    if (rootProjection?.status === "completed") {
      return;
    }
    if (!acted && (rootProjection?.status === "failed" || rootProjection?.status === "blocked")) {
      return;
    }
  }
  throw new Error("Prompt workflow demo did not quiesce.");
}

async function drainTools(toolWorker: ContractToolWorker, threadId: string): Promise<boolean> {
  let acted = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await toolWorker.processOnce(threadId);
    if (!result.acted) {
      return acted;
    }
    acted = true;
  }
  return acted;
}

class DemoThreadEngine implements ThreadEngine, ThreadLeaseStore {
  private readonly events: ThreadEvent[] = [];
  private readonly threads = new Map<string, CreateThreadOptions & { rootThreadId: string }>();

  threadIds(): string[] {
    return [...this.threads.keys()];
  }

  allEvents(): ThreadEvent[] {
    return [...this.events];
  }

  async createThread(threadId: string, options: CreateThreadOptions = {}): Promise<void> {
    if (this.threads.has(threadId)) {
      return;
    }
    this.threads.set(threadId, { ...options, rootThreadId: options.rootThreadId ?? threadId });
  }

  async append(events: ThreadEvent[], _options: AppendOptions = {}): Promise<AppendResult> {
    const firstSeq = this.events.length;
    for (const event of events) {
      if (!this.threads.has(event.threadId)) {
        await this.createThread(event.threadId);
      }
      this.events.push({ ...event, seq: this.events.length } as ThreadEvent);
    }
    return { firstSeq, lastSeq: this.events.length - 1 };
  }

  async read(threadId: string, options: ReadOptions = {}): Promise<ThreadEvent[]> {
    const fromSeq = options.fromSeq ?? 0;
    const events = this.events.filter((event) => event.threadId === threadId && (event.seq ?? 0) >= fromSeq);
    return options.limit === undefined ? events : events.slice(0, options.limit);
  }

  async *follow(_threadId: string, _cursor: FollowCursor = {}): AsyncIterable<ThreadEvent> {}

  async getTail(threadId: string): Promise<{ tailSeq: number; updatedAt: string }> {
    const events = await this.read(threadId);
    return { tailSeq: events.length, updatedAt: nowIso() };
  }

  async getProjection(threadId: string): Promise<ThreadProjection | null> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return null;
    }
    const events = await this.read(threadId);
    const pendingGateIds = events
      .filter((event): event is Extract<ThreadEvent, { type: "gate.created" }> => event.type === "gate.created")
      .filter((gate) => !events.some((event) => event.type === "gate.resolved" && event.payload.gateId === gate.payload.gateId))
      .map((event) => event.payload.gateId);
    return {
      threadId,
      status: statusForEvents(events),
      tailSeq: events.length,
      activeLeaseOwnerId: null,
      pendingGateIds,
      parentThreadId: thread.parentThreadId ?? null,
      rootThreadId: thread.rootThreadId,
      parentScopeKey: thread.parentScopeKey ?? null,
      parentStepKey: thread.parentStepKey ?? null,
      updatedAt: nowIso(),
    };
  }

  async acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease> {
    return {
      threadId,
      ownerId,
      token: `lease:${threadId}:${ownerId}`,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
  }

  async renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease> {
    return {
      threadId,
      ownerId: "renewed",
      token,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
  }

  async releaseLease(): Promise<void> {}
}

function statusForEvents(events: readonly ThreadEvent[]): ThreadProjection["status"] {
  if (events.some((event) => event.type === "tool.failed" || event.type === "agent.failed")) {
    return "failed";
  }
  if (events.some((event) => event.type === "agent.response.produced")) {
    return "completed";
  }
  if (events.some((event) => event.type === "gate.created") && !events.some((event) => event.type === "gate.resolved")) {
    return "blocked";
  }
  if (events.length > 0) {
    return "waiting";
  }
  return "idle";
}

export function workflowPlanHash(plan: WorkflowPlan): string {
  return stableJsonHash(plan);
}
