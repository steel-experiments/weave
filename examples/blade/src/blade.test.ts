import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  ContractToolWorker,
  ThreadProjectionSchema,
  ThreadRunner,
  ThreadService,
  createAgentPlanner,
  deterministicUuid,
  eventKey,
  nowIso,
  type AppendOptions,
  type AppendResult,
  type CreateThreadOptions,
  type FollowCursor,
  type Lease,
  type PutThreadArtifactInput,
  type PutThreadSnapshotInput,
  type ReadOptions,
  type ThreadArtifact,
  type ThreadArtifactStore,
  type ThreadEngine,
  type ThreadEvent,
  type ThreadLeaseStore,
  type ThreadProjection,
  type ThreadSnapshot,
} from "weave";
import { createBladeReviewAgent } from "./agent.js";
import { createBladeApiServer } from "./server.js";
import {
  BladeReviewSynthesisOutputSchema,
  GitHubInspectPullRequestOutputSchema,
  GitHubPublishReviewInputSchema,
  GitHubPublishReviewOutputSchema,
  ReviewFindingSchema,
  createBladeReviewTools,
  createFakeBladeGitHubClient,
  type FakeBladeGitHubClient,
} from "./tools.js";
import { reviewWorkIdempotencyKey, type GitHubReviewRequestedWebhookPayload } from "./github-intake.js";

const webhookSecret = "blade-test-webhook-secret";
const allowedRepository = "steel-dev/agent-mailbox";

async function testValidWebhookCreatesThreadAndDuplicateReusesIt(): Promise<void> {
  const harness = await startHarness();
  try {
    const payload = validReviewRequestedPayload();
    const created = await postWebhook(harness.baseUrl, payload, { deliveryId: "delivery-one" });
    assert.equal(created.status, 202);
    assert(created.body.threadId);

    const duplicate = await postWebhook(harness.baseUrl, payload, { deliveryId: "delivery-two" });
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.body.threadId, created.body.threadId);

    const events = await harness.engine.read(created.body.threadId);
    assert.equal(events.filter((event) => event.type === "session.started").length, 1);
    assert.equal(events.filter((event) => event.type === "prompt.received").length, 1);

    const started = events.find((event): event is Extract<ThreadEvent, { type: "session.started" }> => event.type === "session.started");
    assert(started);
    assert.equal(started.payload.source, "github-action");
    assert.equal(started.payload.agentName, "blade.github-pr-review");
    assert.deepEqual(started.payload.metadata, {
      workItem: {
        source: "github",
        mode: "review",
        trigger: "pull_request.review_requested",
        sourceReference: payload.pull_request.html_url,
        idempotencyKey: reviewWorkIdempotencyKey(allowedRepository, payload.pull_request.number, "blade"),
        requestedReviewer: "blade",
        createdBy: { kind: "github-user", login: "octocat" },
      },
      repository: {
        owner: "steel-dev",
        name: "agent-mailbox",
        fullName: allowedRepository,
        private: true,
        htmlUrl: "https://github.com/steel-dev/agent-mailbox",
      },
      pullRequest: {
        number: 42,
        title: "Review publishing policy",
        bodySummary: "Please review the publish gate path.",
        htmlUrl: "https://github.com/steel-dev/agent-mailbox/pull/42",
        baseRef: "main",
        baseSha: "8d2c4ef",
        headRef: "blade-review-fixture",
        headSha: "9f7a6bc",
        authorLogin: "octocat",
        draft: false,
      },
      policy: {
        publishRequiresGate: true,
        publicRepository: false,
        repositoryAllowed: true,
      },
    });
  } finally {
    harness.close();
  }
}

async function testInvalidWebhookInputsCreateNoThread(): Promise<void> {
  const harness = await startHarness();
  try {
    const invalidSignature = await postWebhook(harness.baseUrl, validReviewRequestedPayload(), { secret: "wrong-secret" });
    assert.equal(invalidSignature.status, 403);

    const invalidPayload = await postWebhook(harness.baseUrl, { action: "review_requested" });
    assert.equal(invalidPayload.status, 400);

    const disallowedRepository = await postWebhook(harness.baseUrl, validReviewRequestedPayload({
      repository: {
        full_name: "steel-dev/private-other",
        name: "private-other",
        private: true,
        html_url: "https://github.com/steel-dev/private-other",
        owner: { login: "steel-dev" },
      },
    }));
    assert.equal(disallowedRepository.status, 403);
    assert.equal(harness.engine.allEvents().length, 0);
  } finally {
    harness.close();
  }
}

async function testReviewRunsThroughInspectFindingsAndArtifactsThenDeniedGateStopsPublish(): Promise<void> {
  const harness = await startHarness();
  try {
    const threadId = await createThreadFromWebhook(harness);
    let events = await pumpUntil(harness, threadId, (history) => history.some((event) => event.type === "gate.created"));

    const inspectLifecycle = lifecycleForTool(events, "github.inspectPullRequest");
    assert.deepEqual(inspectLifecycle, ["tool.requested", "tool.started", "tool.progress", "tool.progress", "tool.progress", "tool.completed"]);

    const inspectCompleted = toolCompleted(events, "github.inspectPullRequest");
    const inspectOutput = GitHubInspectPullRequestOutputSchema.parse(inspectCompleted.payload.output);
    assert.equal(inspectOutput.artifacts.rawDiff.kind, "github-pr-raw-diff");
    assert(inspectOutput.artifacts.rawDiff.byteLength > 20_000);
    assert.equal(harness.artifacts.getBody(inspectOutput.artifacts.rawDiff.artifactId).includes("LARGE_DIFF_SENTINEL_DO_NOT_EMBED"), true);
    assert.equal(JSON.stringify(events).includes("LARGE_DIFF_SENTINEL_DO_NOT_EMBED"), false);
    assert.equal(JSON.stringify(events).includes("RAW_BODY_SENTINEL_DO_NOT_EMBED"), false);

    const synthesisCompleted = toolCompleted(events, "blade.synthesizePullRequestReview");
    const review = BladeReviewSynthesisOutputSchema.parse(synthesisCompleted.payload.output);
    assert.equal(review.findings.length, 1);
    for (const finding of review.findings) {
      const parsed = ReviewFindingSchema.parse(finding);
      assert(parsed.evidence.every((evidence) => evidence.artifactId));
    }
    const findingsArtifactBody = harness.artifacts.getBody(review.artifacts.structuredFindings.artifactId);
    assert.equal(findingsArtifactBody.includes(review.findings[0]?.summary ?? "missing"), true);

    const findingEvents = events.filter((event) => event.type === "agent.finding.produced");
    assert.equal(findingEvents.length, 1);
    assert.equal(findingEvents[0]?.payload.evidence.length, 1);

    const gate = events.find((event): event is Extract<ThreadEvent, { type: "gate.created" }> => event.type === "gate.created");
    assert(gate);
    assert.equal(gate.payload.reason, "pr-review-approval");

    await harness.service.resolveGate(threadId, gate.payload.gateId, "denied", "Human reviewer wants to edit first");
    events = await pumpUntil(harness, threadId, (history) => history.some((event) => event.type === "agent.output.completed"));

    assert.equal(events.some((event) => event.type === "tool.requested" && event.payload.toolName === "github.publishReview"), false);
    assert.equal(harness.githubClient.publishedReviewCount, 0);
    const output = finalOutput(events);
    assert.equal(output.status, "publish-denied");
    assert.equal(output.publishedReviewUrl, null);
  } finally {
    harness.close();
  }
}

async function testApprovedGatePublishesReviewAndRecordsUrl(): Promise<void> {
  const harness = await startHarness();
  try {
    const threadId = await createThreadFromWebhook(harness);
    let events = await pumpUntil(harness, threadId, (history) => history.some((event) => event.type === "gate.created"));
    const gate = events.find((event): event is Extract<ThreadEvent, { type: "gate.created" }> => event.type === "gate.created");
    assert(gate);

    await harness.service.resolveGate(threadId, gate.payload.gateId, "approved", "Publish the review");
    events = await pumpUntil(harness, threadId, (history) => history.some((event) => event.type === "agent.output.completed"));

    const publishLifecycle = lifecycleForTool(events, "github.publishReview");
    assert.deepEqual(publishLifecycle, ["tool.requested", "tool.started", "tool.progress", "tool.progress", "tool.completed"]);
    const published = GitHubPublishReviewOutputSchema.parse(toolCompleted(events, "github.publishReview").payload.output);
    assert.equal(published.deduplicated, false);
    assert.equal(harness.githubClient.publishedReviewCount, 1);

    const output = finalOutput(events);
    assert.equal(output.status, "published");
    assert.equal(output.publishedReviewUrl, published.reviewUrl);
    const finalResponse = events.find((event): event is Extract<ThreadEvent, { type: "agent.response.produced" }> => event.type === "agent.response.produced");
    assert(finalResponse);
    assert(finalResponse.payload.message.includes(published.reviewUrl));
  } finally {
    harness.close();
  }
}

async function testDuplicatePublishAttemptsDoNotDuplicateGitHubReviews(): Promise<void> {
  const engine = new MemoryThreadEngine();
  const githubClient = createFakeBladeGitHubClient();
  const tools = createBladeReviewTools(githubClient);
  const worker = new ContractToolWorker(engine, tools.all, "duplicate-publish-worker");
  const threadId = "duplicate-publish-thread";
  await engine.createThread(threadId);
  const publishInput = GitHubPublishReviewInputSchema.parse({
    owner: "steel-dev",
    repository: "agent-mailbox",
    pullNumber: 42,
    reviewBody: "Blade review body",
    event: "COMMENT",
    inlineComments: [],
    idempotencyKey: "publish:duplicate-key",
    approvalGateId: deterministicUuid("gate", threadId, "duplicate"),
  });
  await engine.append([
    toolRequestEvent(threadId, "publish-one", tools.githubPublishReviewTool.name, publishInput),
    toolRequestEvent(threadId, "publish-two", tools.githubPublishReviewTool.name, publishInput),
  ]);

  assert.equal((await worker.processOnce(threadId)).eventType, "tool.started");
  assert.equal((await worker.processOnce(threadId)).eventType, "tool.completed");
  assert.equal((await worker.processOnce(threadId)).eventType, "tool.started");
  assert.equal((await worker.processOnce(threadId)).eventType, "tool.completed");

  const events = await engine.read(threadId);
  const completed = events.filter((event): event is Extract<ThreadEvent, { type: "tool.completed" }> => event.type === "tool.completed");
  assert.equal(completed.length, 2);
  const first = GitHubPublishReviewOutputSchema.parse(completed[0]?.payload.output);
  const second = GitHubPublishReviewOutputSchema.parse(completed[1]?.payload.output);
  assert.equal(first.reviewUrl, second.reviewUrl);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(githubClient.publishedReviewCount, 1);
}

type Harness = {
  engine: MemoryThreadEngine;
  service: ThreadService;
  runner: ThreadRunner;
  worker: ContractToolWorker;
  artifacts: MemoryArtifactStore;
  githubClient: FakeBladeGitHubClient;
  server: Server;
  baseUrl: string;
  close(): void;
};

async function startHarness(): Promise<Harness> {
  const engine = new MemoryThreadEngine();
  const service = new ThreadService(engine);
  const artifacts = new MemoryArtifactStore();
  const githubClient = createFakeBladeGitHubClient();
  const tools = createBladeReviewTools(githubClient);
  const reviewAgent = createBladeReviewAgent(tools);
  const runner = new ThreadRunner(engine, engine, createAgentPlanner(reviewAgent, reviewAgent.name, { service }), "blade-test-runner");
  const worker = new ContractToolWorker(engine, tools.all, "blade-test-worker", undefined, undefined, artifacts);
  const server = createBladeApiServer(engine, service, {
    webhookSecret,
    allowedRepositories: [allowedRepository],
    bladeReviewerLogins: ["blade"],
    artifactStore: artifacts,
  });
  await listen(server);
  const address = server.address();
  assert(isAddressInfo(address));
  return {
    engine,
    service,
    runner,
    worker,
    artifacts,
    githubClient,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close() {
      server.close();
    },
  };
}

async function createThreadFromWebhook(harness: Harness): Promise<string> {
  const created = await postWebhook(harness.baseUrl, validReviewRequestedPayload());
  assert.equal(created.status, 202);
  assert(created.body.threadId);
  return created.body.threadId;
}

async function pumpUntil(
  harness: Harness,
  threadId: string,
  predicate: (events: ThreadEvent[]) => boolean,
): Promise<ThreadEvent[]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    let events = await harness.engine.read(threadId);
    if (predicate(events)) {
      return events;
    }

    await harness.runner.runOnce(threadId);
    events = await harness.engine.read(threadId);
    if (predicate(events)) {
      return events;
    }

    while (true) {
      const result = await harness.worker.processOnce(threadId);
      events = await harness.engine.read(threadId);
      if (predicate(events)) {
        return events;
      }
      if (!result.acted) {
        break;
      }
    }
  }

  throw new Error(`Timed out waiting for Blade thread ${threadId}`);
}

function lifecycleForTool(events: readonly ThreadEvent[], toolName: string): string[] {
  const toolCallIds = new Set(
    events
      .filter((event): event is Extract<ThreadEvent, { type: "tool.requested" }> => event.type === "tool.requested" && event.payload.toolName === toolName)
      .map((event) => event.payload.toolCallId),
  );
  return events
    .filter((event) => {
      if (event.type === "tool.requested") {
        return event.payload.toolName === toolName;
      }
      if (event.type === "tool.started" || event.type === "tool.progress" || event.type === "tool.completed" || event.type === "tool.failed") {
        return toolCallIds.has(event.payload.toolCallId);
      }
      return false;
    })
    .map((event) => event.type);
}

function toolCompleted(events: readonly ThreadEvent[], toolName: string): Extract<ThreadEvent, { type: "tool.completed" }> {
  const requested = events.find(
    (event): event is Extract<ThreadEvent, { type: "tool.requested" }> => event.type === "tool.requested" && event.payload.toolName === toolName,
  );
  assert(requested);
  const completed = events.find(
    (event): event is Extract<ThreadEvent, { type: "tool.completed" }> => event.type === "tool.completed" && event.payload.toolCallId === requested.payload.toolCallId,
  );
  assert(completed);
  return completed;
}

function finalOutput(events: readonly ThreadEvent[]) {
  const output = events.find((event): event is Extract<ThreadEvent, { type: "agent.output.completed" }> => event.type === "agent.output.completed");
  assert(output);
  return output.payload.output as {
    status: "published" | "publish-denied";
    publishedReviewUrl: string | null;
  };
}

function toolRequestEvent(
  threadId: string,
  stepKey: string,
  toolName: string,
  args: unknown,
): Extract<ThreadEvent, { type: "tool.requested" }> {
  return {
    eventId: eventKey(threadId, "tool.requested", stepKey),
    threadId,
    type: "tool.requested",
    occurredAt: nowIso(),
    scopeKey: "agent:blade-test",
    stepKey,
    actor: { type: "agent", id: "blade-test" },
    payload: {
      toolCallId: deterministicUuid("tool-call", threadId, stepKey, toolName),
      toolName,
      args,
      scopeKey: "agent:blade-test",
      stepKey,
    },
  };
}

async function postWebhook(
  baseUrl: string,
  payload: unknown,
  options: { secret?: string; eventName?: string; deliveryId?: string } = {},
): Promise<{ status: number; body: { threadId?: string; correlationId?: string; statusUrl?: string; eventsUrl?: string; error?: string; ignored?: boolean } }> {
  const body = JSON.stringify(payload);
  const secret = options.secret ?? webhookSecret;
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const response = await fetch(`${baseUrl}/webhooks/github/blade`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": options.eventName ?? "pull_request",
      "x-github-delivery": options.deliveryId ?? "delivery-id",
    },
    body,
  });
  return {
    status: response.status,
    body: await response.json() as { threadId?: string; correlationId?: string; statusUrl?: string; eventsUrl?: string; error?: string; ignored?: boolean },
  };
}

function validReviewRequestedPayload(
  overrides: Partial<GitHubReviewRequestedWebhookPayload> = {},
): GitHubReviewRequestedWebhookPayload {
  const base: GitHubReviewRequestedWebhookPayload = {
    action: "review_requested",
    requested_reviewer: { login: "blade" },
    repository: {
      full_name: allowedRepository,
      name: "agent-mailbox",
      private: true,
      html_url: "https://github.com/steel-dev/agent-mailbox",
      owner: { login: "steel-dev" },
    },
    pull_request: {
      number: 42,
      title: "Review publishing policy",
      body: "Please review the publish gate path.",
      html_url: "https://github.com/steel-dev/agent-mailbox/pull/42",
      draft: false,
      user: { login: "octocat" },
      base: { ref: "main", sha: "8d2c4ef" },
      head: { ref: "blade-review-fixture", sha: "9f7a6bc" },
    },
    sender: { login: "octocat" },
  };
  return { ...base, ...overrides };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}

class MemoryThreadEngine implements ThreadEngine, ThreadLeaseStore {
  private readonly threads = new Map<string, CreateThreadOptions & { rootThreadId: string }>();
  private readonly events: ThreadEvent[] = [];

  async createThread(threadId: string, options: CreateThreadOptions = {}): Promise<void> {
    if (this.threads.has(threadId)) {
      return;
    }
    this.threads.set(threadId, {
      ...options,
      rootThreadId: options.rootThreadId ?? threadId,
    });
  }

  async append(events: ThreadEvent[], _options: AppendOptions = {}): Promise<AppendResult> {
    const firstSeq = this.events.length;
    for (const event of events) {
      this.events.push({ ...event, seq: this.events.length } as ThreadEvent);
      if (!this.threads.has(event.threadId)) {
        this.threads.set(event.threadId, { rootThreadId: event.threadId });
      }
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
      .filter((created) => !events.some((event) => event.type === "gate.resolved" && event.payload.gateId === created.payload.gateId))
      .map((event) => event.payload.gateId);
    return ThreadProjectionSchema.parse({
      threadId,
      status: statusForEvents(events, pendingGateIds),
      tailSeq: events.length,
      activeLeaseOwnerId: null,
      pendingGateIds,
      parentThreadId: thread.parentThreadId ?? null,
      rootThreadId: thread.rootThreadId,
      parentScopeKey: thread.parentScopeKey ?? null,
      parentStepKey: thread.parentStepKey ?? null,
      updatedAt: nowIso(),
    });
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

  allEvents(): ThreadEvent[] {
    return this.events;
  }
}

function statusForEvents(events: readonly ThreadEvent[], pendingGateIds: readonly string[]): ThreadProjection["status"] {
  if (events.some((event) => event.type === "agent.failed" || event.type === "tool.failed")) {
    return "failed";
  }
  if (pendingGateIds.length > 0) {
    return "blocked";
  }
  if (events.some((event) => event.type === "agent.output.completed" || event.type === "agent.response.produced")) {
    return "completed";
  }
  return events.length > 0 ? "waiting" : "idle";
}

class MemoryArtifactStore implements ThreadArtifactStore {
  private readonly artifacts = new Map<string, ThreadArtifact>();
  private readonly bodies = new Map<string, string>();
  private readonly snapshots = new Map<string, ThreadSnapshot>();

  async putArtifact(input: PutThreadArtifactInput): Promise<ThreadArtifact> {
    const artifactId = randomUUID();
    const body = typeof input.body === "string" ? input.body : Buffer.from(input.body).toString("utf8");
    const artifact: ThreadArtifact = {
      artifactId,
      threadId: input.threadId,
      toolCallId: input.toolCallId ?? null,
      kind: input.kind,
      mediaType: input.mediaType,
      sha256: createHash("sha256").update(body).digest("hex"),
      byteLength: Buffer.byteLength(body, "utf8"),
      uri: `memory://artifact/${artifactId}`,
      sourceUrl: input.sourceUrl,
      createdAt: nowIso(),
    };
    this.artifacts.set(artifactId, artifact);
    this.bodies.set(artifactId, body);
    return artifact;
  }

  async listArtifacts(threadId: string): Promise<ThreadArtifact[]> {
    return [...this.artifacts.values()].filter((artifact) => artifact.threadId === threadId);
  }

  async getSnapshot(snapshotKey: string): Promise<ThreadSnapshot | null> {
    return this.snapshots.get(snapshotKey) ?? null;
  }

  async putSnapshot(input: PutThreadSnapshotInput): Promise<ThreadSnapshot> {
    const snapshot: ThreadSnapshot = {
      snapshotKey: input.snapshotKey,
      threadId: input.threadId,
      artifactId: input.artifactId,
      sha256: input.sha256,
      metadata: input.metadata,
      updatedAt: nowIso(),
    };
    this.snapshots.set(input.snapshotKey, snapshot);
    return snapshot;
  }

  getBody(artifactId: string): string {
    const body = this.bodies.get(artifactId);
    if (body === undefined) {
      throw new Error(`Artifact body not found: ${artifactId}`);
    }
    return body;
  }
}

await testValidWebhookCreatesThreadAndDuplicateReusesIt();
await testInvalidWebhookInputsCreateNoThread();
await testReviewRunsThroughInspectFindingsAndArtifactsThenDeniedGateStopsPublish();
await testApprovedGatePublishesReviewAndRecordsUrl();
await testDuplicatePublishAttemptsDoNotDuplicateGitHubReviews();

console.log("Blade GitHub PR review tests passed");
