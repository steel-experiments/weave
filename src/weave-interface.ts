export interface WeaveModuleBoundary {
  defineTool<const Name extends string, Input, Output>(
    contract: ToolContract<Name, Input, Output>,
  ): ToolContract<Name, Input, Output>;
  tool<const Name extends string, Input, Output>(
    contract: ToolContract<Name, Input, Output>,
  ): ToolContract<Name, Input, Output>;
  createToolRegistry(tools: readonly AnyToolContract[]): ToolRegistry;

  defineAgent<const Name extends string, Input, Output, const Tools extends readonly AnyToolContract[]>(
    contract: AgentContract<Name, Input, Output, Tools>,
  ): AgentContract<Name, Input, Output, Tools>;
  agent<const Name extends string, Input, Output, const Tools extends readonly AnyToolContract[]>(
    contract: AgentContract<Name, Input, Output, Tools>,
  ): AgentContract<Name, Input, Output, Tools>;
  defineIntegration<const Name extends string, const Tools extends readonly AnyToolContract[]>(
    contract: IntegrationContract<Name, Tools>,
  ): IntegrationContract<Name, Tools>;
  integration<const Name extends string, const Tools extends readonly AnyToolContract[]>(
    contract: IntegrationContract<Name, Tools>,
  ): IntegrationContract<Name, Tools>;
  approvalPolicy<Input>(definition: ApprovalPolicyDefinition<Input>): ApprovalPolicy<Input>;
  defineApprovalPolicy<Input>(definition: ApprovalPolicyDefinition<Input>): ApprovalPolicy<Input>;
  event<const Type extends ThreadEvent["type"]>(
    type: Type,
    payload: Extract<ThreadEvent, { type: Type }>["payload"],
    metadata?: AgentEventMetadata,
  ): AgentEventInput<Type>;
  defineEvent<const Type extends ThreadEvent["type"]>(
    type: Type,
    payload: Extract<ThreadEvent, { type: Type }>["payload"],
    metadata?: AgentEventMetadata,
  ): AgentEventInput<Type>;
  defineWeaveApp<
    const Agents extends readonly AgentContract[],
    const Integrations extends readonly IntegrationContract[] = readonly IntegrationContract[],
  >(
    app: WeaveAppDefinition<Agents, Integrations>,
  ): WeaveAppDefinition<Agents, Integrations>;
  weave<
    const Agents extends readonly AgentContract[],
    const Integrations extends readonly IntegrationContract[] = readonly IntegrationContract[],
  >(
    app: WeaveAppDefinition<Agents, Integrations>,
  ): WeaveAppDefinition<Agents, Integrations>;

  createApiServer(engine: ThreadEngine, service: ThreadService, options?: ApiServerOptions): HttpServer;
  createWeaveRuntime(options: WeaveRuntimeOptions): WeaveRuntime;
  createPool(): DatabasePool;
  migrate(pool: DatabasePool, options?: { reset?: boolean }): Promise<void>;

  ThreadService: new (engine: ThreadEngine) => ThreadService;
  ThreadRunner: new (
    engine: ThreadEngine,
    leases: ThreadLeaseStore,
    agent?: AgentPlanner,
    ownerId?: string,
    observability?: ObservabilitySink,
  ) => ThreadRunner;
  ContractToolWorker: new (
    engine: ThreadEngine,
    tools: readonly AnyToolContract[] | ToolRegistry,
    workerId?: string,
    credentialProvider?: CredentialProvider,
    observability?: ObservabilitySink,
    artifactStore?: ThreadArtifactStore,
  ) => ToolWorker;
  PostgresThreadEngine: new (pool: DatabasePool) => ThreadEngine & ThreadLeaseStore & InboxStore;

  buildThreadSummary(projection: ThreadProjection, events: readonly ThreadEvent[]): ThreadSummary;
  toTextTimeline(events: readonly ThreadEvent[]): string;
  toMermaidTimeline(events: readonly ThreadEvent[]): string;
}

interface WeaveAppDefinition<
  Agents extends readonly AgentContract[] = readonly AgentContract[],
  Integrations extends readonly IntegrationContract[] = readonly IntegrationContract[],
> {
  name?: string;
  agents: Agents;
  tools?: readonly AnyToolContract[];
  integrations?: Integrations;
  credentialProvider?: CredentialProvider;
  artifactStore?: ThreadArtifactStore;
  observability?: ObservabilitySink;
}

interface AgentContract<
  Name extends string = string,
  Input = unknown,
  Output = unknown,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> {
  name: Name;
  description?: string;
  input?: Schema<Input>;
  output?: Schema<Output>;
  tools?: Tools;
  run?(context: AgentContext<Tools>, input: Input): Promise<Output> | Output;
  planner?: AgentPlanner;
}

interface AgentContext<Tools extends readonly AnyToolContract[] = readonly AnyToolContract[]> {
  readonly threadId: string;
  readonly actor: Actor;
  readonly signal: AbortSignal;
  tool<Input, Output>(key: string, tool: ToolContract<string, Input, Output>, input: Input, options?: ToolCallOptions): Promise<Output>;
  gate(key: string, request: GateRequest): Promise<GateResolution>;
  spawn<Input extends Record<string, unknown>, Output>(
    key: string,
    agent: AgentContract<string, Input, Output>,
    input: Input,
    options?: SpawnOptions,
  ): Promise<ThreadRef<Output>>;
  join<Output>(key: string, thread: ThreadRef<Output>, options?: JoinOptions): Promise<AgentRun<Output>>;
  cancelChild(key: string, thread: ThreadRef, options?: CancelChildOptions): Promise<void>;
  children(options?: ChildrenOptions): Promise<readonly ThreadRef[]>;
  checkpoint<Value>(key: string, compute: () => Promise<Value> | Value): Promise<Value>;
  emit(key: string, event: AgentEventInput): Promise<void>;
  uuid(key: string): string;
}

interface IntegrationContract<
  Name extends string = string,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> {
  name: Name;
  description?: string;
  tools?: Tools;
  createRoutes?(context: IntegrationRuntimeContext): readonly ApiRouteHandler[];
  eventHandlers?: readonly IntegrationEventHandler[];
}

interface ApprovalPolicy<Input> {
  name: string;
  description?: string;
  requiresApproval(input: Input): boolean;
  gate(input: Input): GateRequest;
  evaluate(input: Input): GateRequest | undefined;
}

interface ApprovalPolicyDefinition<Input> {
  name: string;
  description?: string;
  requiresApproval(input: Input): boolean;
  gate(input: Input): GateRequest;
}

interface ToolContract<
  Name extends string = string,
  Input = unknown,
  Output = unknown,
> {
  name: Name;
  description: string;
  input: Schema<Input>;
  output: Schema<Output>;
  summarize?(output: Output): string;
  gate?(context: { input: Input }): ManualToolGate | undefined;
  credentials?(context: { input: Input }): CredentialRequest | readonly CredentialRequest[] | undefined;
  run(context: ToolRunContext<Input>): Promise<Output> | Output;
}

type AnyToolContract = ToolContract<string, unknown, unknown>;

interface ThreadEngine {
  createThread(threadId: string, options?: CreateThreadOptions): Promise<void>;
  append(events: ThreadEvent[], options?: AppendOptions): Promise<AppendResult>;
  read(threadId: string, options?: ReadOptions): Promise<ThreadEvent[]>;
  follow(threadId: string, cursor?: FollowCursor): AsyncIterable<ThreadEvent>;
  getTail(threadId: string): Promise<{ tailSeq: number; updatedAt: string }>;
  getProjection(threadId: string): Promise<ThreadProjection | null>;
}

interface ThreadLeaseStore {
  acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease | null>;
  renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease>;
  releaseLease(threadId: string, token: string): Promise<void>;
}

interface ThreadService {
  startSession(input: string | StartSessionInput): Promise<{ threadId: string; correlationId: string }>;
  startChildSession(input: StartChildSessionInput): Promise<StartChildSessionResult>;
  cancelChildThread(input: CancelChildThreadInput): Promise<CancelChildThreadResult>;
  listChildren(parentThreadId: string, options?: ChildrenOptions): Promise<readonly ThreadRef[]>;
  resolveGate(threadId: string, gateId: string, resolution: "approved" | "denied", comment?: string): Promise<void>;
}

interface WeaveRuntimeOptions {
  app: WeaveAppDefinition;
  agentName: string;
  engine: ThreadEngine & ThreadLeaseStore & InboxStore;
  service: ThreadService;
  intervalMs?: number;
  runnerOwnerId?: string;
  toolWorkerId?: string;
}

interface WeaveRuntime {
  runner: ThreadRunner;
  toolWorker: ToolWorker;
  runnerDaemon: Daemon;
  toolDaemon: Daemon;
}

interface ThreadRunner {
  runOnce(threadId: string): Promise<{ acted: boolean; appendedEvents: number; reason?: string }>;
}

interface ToolWorker {
  processOnce(threadId: string): Promise<{ acted: boolean; eventType?: string; errorCode?: string; errorMessage?: string }>;
}

interface Daemon {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
}

interface AgentPlanner {
  plan(threadId: string, events: ThreadEvent[]): Promise<AgentPlan | null> | AgentPlan | null;
}

interface AgentPlan {
  resumeReason: "new-prompt" | "tool-completed" | "gate-resolved";
  events: ThreadEvent[];
}

interface ThreadEvent {
  eventId: string;
  threadId: string;
  seq?: number;
  type: string;
  occurredAt: string;
  actor: Actor;
  payload: unknown;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  scopeKey?: string;
  stepKey?: string;
}

interface ThreadProjection {
  threadId: string;
  status: "idle" | "running" | "waiting" | "blocked" | "completed" | "failed";
  tailSeq: number;
  activeLeaseOwnerId?: string | null;
  pendingGateIds: string[];
  parentThreadId?: string | null;
  rootThreadId?: string | null;
  parentScopeKey?: string | null;
  parentStepKey?: string | null;
  updatedAt: string;
}

interface ThreadSummary extends ThreadProjection {
  outcome: "passed" | "warning" | "failed" | null;
  finalMessage: string | null;
}

interface ToolRunContext<Input> {
  threadId: string;
  toolCallId: string;
  toolName: string;
  input: Input;
  credentials: ResolvedCredentials;
  artifactStore: ThreadArtifactStore;
  observe: ToolObserver;
  request: Extract<ThreadEvent, { type: "tool.requested" }>;
  progress(update: ToolProgressUpdate): Promise<void>;
}

interface LegacyToolOutput {
  summary: string;
  requiresManualApproval: boolean;
  data?: unknown;
}

interface ManualToolGate {
  type: "manual-approval";
  reason: "tool-result-requires-approval" | "risky-remediation";
  message?: string;
  proposedAction?: string;
}

interface IntegrationRuntimeContext {
  engine: ThreadEngine;
  service: ThreadService;
  integrationName: string;
}

interface IntegrationEventHandler {
  eventTypes?: readonly string[];
  handle(event: ThreadEvent, context: IntegrationRuntimeContext): Promise<void> | void;
}

type ApiRouteHandler = (request: unknown, response: unknown) => Promise<boolean> | boolean;

interface ApiServerOptions {
  app?: WeaveAppDefinition;
  artifactStore?: ThreadArtifactStore;
  observability?: ObservabilitySink;
  observabilityReader?: ObservabilityReader;
  beforeRoutes?: readonly ApiRouteHandler[];
}

interface CredentialProvider {
  resolve(request: CredentialRequest, context: CredentialResolutionContext): Promise<CredentialResolution | null>;
}

interface ThreadArtifactStore {
  putArtifact(input: PutThreadArtifactInput): Promise<ThreadArtifact>;
  listArtifacts(threadId: string): Promise<ThreadArtifact[]>;
  getSnapshot(snapshotKey: string): Promise<ThreadSnapshot | null>;
  putSnapshot(input: PutThreadSnapshotInput): Promise<ThreadSnapshot>;
}

interface ObservabilitySink {
  emitSpan(span: ThreadSpanRecord): Promise<void>;
  emitLog(record: ThreadLogRecord): Promise<void>;
}

interface ObservabilityReader {
  listSpans(threadId: string): Promise<ThreadSpanRecord[]>;
  listLogs(threadId: string): Promise<ThreadLogRecord[]>;
}

interface InboxStore {
  claimInbox(consumer: "runner" | "tool-worker", ownerId: string, limit: number, ttlMs: number): Promise<InboxWorkItem[]>;
  completeInbox(ids: number[], ownerId: string): Promise<void>;
  deadLetterInbox(ids: number[], ownerId: string, errorCode?: string, errorMessage?: string): Promise<void>;
}

type Actor = { type: "user" | "agent" | "worker" | "human" | "system"; id: string };
type StartSessionInput = { prompt: string; source?: string; agentName?: string; actor?: Actor; metadata?: Record<string, unknown>; idempotencyKey?: string };
type StartChildSessionInput = {
  parentThreadId: string;
  agentName: string;
  input: Record<string, unknown>;
  prompt?: string;
  source?: string;
  actor?: Actor;
  metadata?: Record<string, unknown>;
  parentScopeKey?: string;
  parentStepKey?: string;
  detached?: boolean;
  idempotencyKey?: string;
};
type StartChildSessionResult = {
  threadId: string;
  correlationId: string;
  parentThreadId: string;
  rootThreadId: string;
};
type ToolCallOptions = Record<string, unknown>;
type ThreadRef<Output = unknown> = {
  threadId: string;
  agentName: string;
  parentThreadId?: string;
  rootThreadId?: string;
  parentScopeKey?: string;
  parentStepKey?: string;
  status?: ThreadProjection["status"];
  outputSchema?: Schema<Output>;
  output?: Output;
};
type SpawnOptions = {
  prompt?: string;
  source?: string;
  actor?: Actor;
  metadata?: Record<string, unknown>;
  detached?: boolean;
};
type JoinOptions = { throwOnFailure?: boolean };
type ChildrenOptions = { includeDetached?: boolean; agentName?: string | readonly string[]; status?: ThreadProjection["status"] | readonly ThreadProjection["status"][] };
type CancelChildOptions = { reason?: string; actor?: Actor };
type CancelChildThreadInput = { parentThreadId: string; childThreadId: string; childAgentName?: string; parentScopeKey?: string; parentStepKey?: string; reason?: string; actor?: Actor };
type CancelChildThreadResult = { childThreadId: string; cancelled: boolean; errorCode: "CHILD_CANCELLED" };
type AgentRun<Output = unknown> =
  | { status: "completed"; thread: ThreadRef<Output>; output?: Output; outputSummary?: string }
  | { status: "failed"; thread: ThreadRef<Output>; errorCode: string; message: string };
type GateRequest = { gateType?: "manual-approval"; reason: "tool-result-requires-approval" | "risky-remediation"; relatedToolCallId?: string; proposedAction?: string };
type GateResolution = { gateId: string; resolution: "approved" | "denied"; comment?: string };
type AgentEventMetadata = { correlationId?: string; causationId?: string; idempotencyKey?: string };
type AgentEventInput<Type extends ThreadEvent["type"] = ThreadEvent["type"]> = Type extends ThreadEvent["type"]
  ? AgentEventMetadata & { type: Type; payload: Extract<ThreadEvent, { type: Type }>["payload"] }
  : never;
type AppendOptions = { expectedTailSeq?: number; idempotencyKey?: string };
type AppendResult = { firstSeq: number; lastSeq: number };
type CreateThreadOptions = { parentThreadId?: string; rootThreadId?: string; parentScopeKey?: string; parentStepKey?: string };
type ReadOptions = { fromSeq?: number; limit?: number };
type FollowCursor = { fromSeq?: number; tail?: boolean };
type Lease = { threadId: string; ownerId: string; token: string; expiresAt: Date };
type ToolProgressUpdate = { percent: number; message: string };
type CredentialRequest = { name: string; kind: "secret" | "delegated-identity" | "scoped-token" | "browser-session"; reason?: string };
type CredentialResolution = CredentialRequest & { source: string; value?: string; subject?: string; expiresAt?: Date };
type CredentialResolutionContext = { threadId: string; toolCallId: string; toolName: string };
type ResolvedCredentials = { get(name: string): CredentialResolution; value(name: string): string; has(name: string): boolean };
type PutThreadArtifactInput = { threadId: string; toolCallId?: string; kind: string; mediaType: string; sourceUrl: string; body: string | Uint8Array };
type PutThreadSnapshotInput = { snapshotKey: string; threadId: string; artifactId: string; sha256: string; metadata?: Record<string, unknown> };
type ThreadArtifact = PutThreadArtifactInput & { artifactId: string; sha256: string; byteLength: number; uri: string; createdAt: Date };
type ThreadSnapshot = PutThreadSnapshotInput & { updatedAt: Date };
type ThreadSpanRecord = { name: string; status: "ok" | "error"; startedAt: Date; endedAt: Date; attributes?: Record<string, unknown> };
type ThreadLogRecord = { timestamp: Date; level: "debug" | "info" | "warn" | "error"; message: string; attributes?: Record<string, unknown> };
type InboxWorkItem = { id: number; threadId: string; eventSeq: number; attempts: number };
type DatabasePool = { query(sql: string, values?: readonly unknown[]): Promise<unknown>; connect?(): Promise<unknown>; end?(): Promise<void> };
type HttpServer = { listen(...args: unknown[]): unknown; close(callback?: (error?: Error) => void): unknown };
type ToolRegistry = { get(name: string): AnyToolContract | undefined; list(): AnyToolContract[] };
type ToolObserver = unknown;
type Schema<T> = { parse(value: unknown): T; safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } };

export type Weave = WeaveModuleBoundary;
