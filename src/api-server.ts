import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { MailboxEngine } from "./contracts.js";
import { ActorSchema, SessionMetadataSchema, SessionSourceSchema } from "./events.js";
import type { MailboxService } from "./mailbox-service.js";
import {
  NoopObservabilitySink,
  elapsedMs,
  newSpanId,
  newTraceId,
  safeEmitLog,
  safeEmitSpan,
  type ObservabilityReader,
  type ObservabilitySink,
} from "./observability.js";

const CreateMailboxBodySchema = z.object({
  prompt: z.string().min(1),
  source: SessionSourceSchema.optional(),
  actor: ActorSchema.optional(),
  metadata: SessionMetadataSchema.optional(),
  idempotencyKey: z.string().min(1).optional(),
});

const ResolveGateBodySchema = z.object({
  resolution: z.enum(["approved", "denied"]),
  comment: z.string().optional(),
});

export type ApiServerOptions = {
  observability?: ObservabilitySink;
  observabilityReader?: ObservabilityReader;
};

export function createApiServer(engine: MailboxEngine, service: MailboxService, options: ApiServerOptions = {}): Server {
  const observability = options.observability ?? new NoopObservabilitySink();
  return createServer(async (request, response) => {
    const span = apiSpanContext(request);
    const startedAt = new Date();
    let statusCode = 500;
    try {
      await routeRequest(engine, service, request, response, options.observabilityReader, observability, span);
      statusCode = response.statusCode;
      await safeEmitLog(observability, {
        ...span,
        timestamp: nowIso(),
        level: statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
        message: "API request completed",
        attributes: { method: request.method ?? "GET", path: request.url ?? "/", statusCode },
      });
      await emitApiSpan(observability, span, startedAt, statusCode >= 500 ? "error" : "ok", { statusCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await safeEmitLog(observability, {
        ...span,
        timestamp: nowIso(),
        level: "error",
        message: "API request failed",
        attributes: { method: request.method ?? "GET", path: request.url ?? "/", error: message },
      });
      await emitApiSpan(observability, span, startedAt, "error", { error: message });
      writeJson(response, 500, { error: message });
    }
  });
}

async function routeRequest(
  engine: MailboxEngine,
  service: MailboxService,
  request: IncomingMessage,
  response: ServerResponse,
  observabilityReader: ObservabilityReader | undefined,
  observability: ObservabilitySink,
  span: { traceId: string; spanId: string; mailboxId?: string },
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/mailboxes") {
    const body = CreateMailboxBodySchema.parse(await readJson(request));
    const session = await service.startSession({
      ...body,
      source: body.source ?? "api",
      actor: body.actor ?? { type: "user", id: "api-user" },
    });
    const projection = await engine.getProjection(session.mailboxId);
    await safeEmitLog(observability, {
      ...span,
      mailboxId: session.mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox session created",
      attributes: { hasProjection: projection !== null },
    });
    writeJson(response, 201, { ...session, projection });
    return;
  }

  const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)$/);
  if (method === "GET" && mailboxMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(mailboxMatch, 1));
    const projection = await engine.getProjection(mailboxId);
    if (!projection) {
      writeJson(response, 404, { error: "Mailbox not found" });
      return;
    }
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox projection read",
      attributes: { status: projection.status, tailSeq: projection.tailSeq },
    });
    writeJson(response, 200, projection);
    return;
  }

  const eventsMatch = path.match(/^\/mailboxes\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(eventsMatch, 1));
    const fromSeq = parseOptionalInt(url.searchParams.get("fromSeq"));
    const limit = parseOptionalInt(url.searchParams.get("limit"));
    const events = await engine.read(mailboxId, { fromSeq, limit });
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox events read",
      attributes: { count: events.length, fromSeq, limit },
    });
    writeJson(response, 200, { events });
    return;
  }

  const observabilitySpansMatch = path.match(/^\/mailboxes\/([^/]+)\/observability\/spans$/);
  if (method === "GET" && observabilitySpansMatch) {
    if (!observabilityReader) {
      writeJson(response, 503, { error: "Observability reader not configured" });
      return;
    }
    const mailboxId = decodeURIComponent(requiredMatch(observabilitySpansMatch, 1));
    const spans = await observabilityReader.listSpans(mailboxId);
    writeJson(response, 200, { spans });
    return;
  }

  const observabilityLogsMatch = path.match(/^\/mailboxes\/([^/]+)\/observability\/logs$/);
  if (method === "GET" && observabilityLogsMatch) {
    if (!observabilityReader) {
      writeJson(response, 503, { error: "Observability reader not configured" });
      return;
    }
    const mailboxId = decodeURIComponent(requiredMatch(observabilityLogsMatch, 1));
    const logs = await observabilityReader.listLogs(mailboxId);
    writeJson(response, 200, { logs });
    return;
  }

  const resolveGateMatch = path.match(/^\/mailboxes\/([^/]+)\/gates\/([^/]+)\/resolve$/);
  if (method === "POST" && resolveGateMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(resolveGateMatch, 1));
    const gateId = decodeURIComponent(requiredMatch(resolveGateMatch, 2));
    const body = ResolveGateBodySchema.parse(await readJson(request));
    await service.resolveGate(mailboxId, gateId, body.resolution, body.comment);
    const projection = await engine.getProjection(mailboxId);
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Gate resolved via API",
      attributes: { gateId, resolution: body.resolution },
    });
    writeJson(response, 200, { projection });
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function apiSpanContext(request: IncomingMessage): { traceId: string; spanId: string; mailboxId?: string } {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)/);
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    mailboxId: mailboxMatch?.[1] ? decodeURIComponent(mailboxMatch[1]) : undefined,
  };
}

async function emitApiSpan(
  observability: ObservabilitySink,
  span: { traceId: string; spanId: string; mailboxId?: string },
  startedAt: Date,
  status: "ok" | "error",
  attributes: Record<string, unknown>,
): Promise<void> {
  await safeEmitSpan(observability, {
    ...span,
    name: "api.request",
    kind: "http",
    status,
    startedAt: startedAt.toISOString(),
    endedAt: nowIso(),
    durationMs: elapsedMs(startedAt),
    attributes,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function requiredMatch(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (!value) {
    throw new Error("Invalid route match");
  }
  return value;
}
