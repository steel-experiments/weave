export interface WeaveModuleBoundary {
  defineTool<const Name extends string, Input, Output extends ToolOutput>(
    contract: ToolContract<Name, Input, Output>,
  ): ToolContract<Name, Input, Output>;
  createToolRegistry(tools: readonly AnyToolContract[]): ToolRegistry;

  defineAgent<const Name extends string, const Tools extends readonly AnyToolContract[]>(
    contract: AgentContract<Name, Tools>,
  ): AgentContract<Name, Tools>;
  defineIntegration<const Name extends string, const Tools extends readonly AnyToolContract[]>(
    contract: IntegrationContract<Name, Tools>,
  ): IntegrationContract<Name, Tools>;
  defineWeaveApp<
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
  integrations?: Integrations;
  credentialProvider?: CredentialProvider;
  artifactStore?: ThreadArtifactStore;
  observability?: ObservabilitySink;
}

interface AgentContract<
  Name extends string = string,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> {
  name: Name;
  description?: string;
  planner: AgentPlanner;
  tools: Tools;
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

interface ToolContract<
  Name extends string = string,
  Input = unknown,
  Output extends ToolOutput = ToolOutput,
> {
  name: Name;
  description: string;
  input: Schema<Input>;
  output: Schema<Output>;
  gate?(context: { input: Input }): ManualToolGate | undefined;
  credentials?(context: { input: Input }): CredentialRequest | readonly CredentialRequest[] | undefined;
  run(context: ToolRunContext<Input>): Promise<Output> | Output;
}

type AnyToolContract = ToolContract<string, unknown, ToolOutput>;

interface ThreadEngine {
  createThread(threadId: string): Promise<void>;
  append(events: ThreadEvent[], options?: AppendOptions): Promise<AppendResult>;
  read(threadId: string, options?: ReadOptions): Promise<ThreadEvent[]>;
  follow(threadId: string, cursor?: FollowCursor): AsyncIterable<ThreadEvent>;
  getTail(threadId: string): Promise<{ tailSeq: number; updatedAt: Date }>;
  getProjection(threadId: string): Promise<ThreadProjection | null>;
}

interface ThreadLeaseStore {
  acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease | null>;
  renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease>;
  releaseLease(threadId: string, token: string): Promise<void>;
}

interface ThreadService {
  startSession(input: string | StartSessionInput): Promise<{ threadId: string; correlationId: string }>;
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
  plan(threadId: string, events: ThreadEvent[]): { resumeReason: "new-prompt" | "tool-completed" | "gate-resolved"; events: ThreadEvent[] } | null;
}

interface ThreadEvent {
  eventId: string;
  threadId: string;
  seq?: number;
  type: string;
  occurredAt: Date;
  actor: Actor;
  payload: unknown;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
}

interface ThreadProjection {
  threadId: string;
  status: "idle" | "running" | "waiting" | "blocked" | "completed" | "failed";
  tailSeq: number;
  activeLeaseOwnerId?: string | null;
  pendingGateIds: string[];
  updatedAt: Date;
}

interface ThreadSummary extends ThreadProjection {
  outcome: "passed" | "warning" | "failed" | null;
  finalMessage: string | null;
}

interface ToolRunContext<Input> {
  threadId: string;
  toolCallId: string;
  input: Input;
  credentials: ResolvedCredentials;
  artifactStore: ThreadArtifactStore;
  progress(update: ToolProgressUpdate): Promise<void>;
}

interface ToolOutput {
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
type StartSessionInput = { prompt: string; source?: string; actor?: Actor; metadata?: Record<string, unknown>; idempotencyKey?: string };
type AppendOptions = { expectedTailSeq?: number; idempotencyKey?: string };
type AppendResult = { firstSeq: number; lastSeq: number };
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
type Schema<T> = { parse(value: unknown): T; safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown } };

export type Weave = WeaveModuleBoundary;
