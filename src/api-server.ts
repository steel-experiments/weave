import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { MailboxEngine } from "./contracts.js";
import type { MailboxService } from "./mailbox-service.js";

const CreateMailboxBodySchema = z.object({
  prompt: z.string().min(1),
});

const ResolveGateBodySchema = z.object({
  resolution: z.enum(["approved", "denied"]),
  comment: z.string().optional(),
});

export function createApiServer(engine: MailboxEngine, service: MailboxService): Server {
  return createServer(async (request, response) => {
    try {
      await routeRequest(engine, service, request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      writeJson(response, 500, { error: message });
    }
  });
}

async function routeRequest(
  engine: MailboxEngine,
  service: MailboxService,
  request: IncomingMessage,
  response: ServerResponse,
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
    const session = await service.startSession(body.prompt);
    const projection = await engine.getProjection(session.mailboxId);
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
    writeJson(response, 200, projection);
    return;
  }

  const eventsMatch = path.match(/^\/mailboxes\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(eventsMatch, 1));
    const fromSeq = parseOptionalInt(url.searchParams.get("fromSeq"));
    const limit = parseOptionalInt(url.searchParams.get("limit"));
    const events = await engine.read(mailboxId, { fromSeq, limit });
    writeJson(response, 200, { events });
    return;
  }

  const resolveGateMatch = path.match(/^\/mailboxes\/([^/]+)\/gates\/([^/]+)\/resolve$/);
  if (method === "POST" && resolveGateMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(resolveGateMatch, 1));
    const gateId = decodeURIComponent(requiredMatch(resolveGateMatch, 2));
    const body = ResolveGateBodySchema.parse(await readJson(request));
    await service.resolveGate(mailboxId, gateId, body.resolution, body.comment);
    const projection = await engine.getProjection(mailboxId);
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
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
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
