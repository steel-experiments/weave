import { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ThreadService, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadEngine, createPool, migrate } from "weave/postgres";
import { createApiServer } from "weave/server";
import { z } from "zod";
import type { ThreadEvent } from "weave";
import { simpleAssistantApp } from "./app.js";

const AssistantRequestSchema = z.object({
  prompt: z.string().min(1),
  waitMs: z.number().int().positive().max(120_000).optional(),
});

if (!process.env.OPENCODE_API_KEY) {
  throw new Error("Set OPENCODE_API_KEY in your shell or examples/simple-assistant/.env before running the server.");
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const pool = createPool();

await migrate(pool);

const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
const runtime = createWeaveRuntime({
  app: simpleAssistantApp,
  agentName: "assistant",
  engine,
  service,
  intervalMs: 25,
  toolWorkerId: "simple-assistant-tool-worker",
});
const { runnerDaemon, toolDaemon } = runtime;

let serverBaseUrl = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof createApiServer> | undefined;

const listenResult = await listenWithFallback(port, process.env.PORT === undefined);
server = listenResult.server;
serverBaseUrl = `http://127.0.0.1:${listenResult.port}`;
runnerDaemon.start();
toolDaemon.start();

console.log(`Simple assistant listening on ${serverBaseUrl}`);
console.log("POST /assistant with { prompt } for a completed assistant response.");
console.log("POST /threads with { agentName: 'assistant', prompt } to use the raw Weave API.");

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function assistantRoute(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  if (method !== "POST" || url.pathname !== "/assistant") {
    return false;
  }

  const body = AssistantRequestSchema.parse(await readJson(request));
  const session = await service.startSession({
    prompt: body.prompt,
    agentName: "assistant",
    source: "api",
    actor: { type: "user", id: "assistant-api-user" },
  });

  const projection = await waitForTerminal(session.threadId, body.waitMs ?? 60_000);
  const events = await engine.read(session.threadId);
  const finalResponse = events.find((event) => event.type === "agent.response.produced");

  if (projection.status !== "completed" || !finalResponse) {
    writeJson(response, 502, {
      threadId: session.threadId,
      status: projection.status,
      error: describeFailure(events),
      eventsUrl: `${serverBaseUrl}/threads/${session.threadId}/events`,
      streamUrl: `${serverBaseUrl}/threads/${session.threadId}/stream`,
    });
    return true;
  }

  writeJson(response, 200, {
    threadId: session.threadId,
    status: projection.status,
    message: finalResponse.payload.message,
    eventsUrl: `${serverBaseUrl}/threads/${session.threadId}/events`,
    streamUrl: `${serverBaseUrl}/threads/${session.threadId}/stream`,
  });
  return true;
}

async function listenWithFallback(
  startPort: number,
  allowFallback: boolean,
): Promise<{ server: ReturnType<typeof createApiServer>; port: number }> {
  const maxPort = allowFallback ? startPort + 10 : startPort;

  for (let candidatePort = startPort; candidatePort <= maxPort; candidatePort += 1) {
    const candidateServer = createAssistantServer();
    try {
      const boundPort = await listen(candidateServer, candidatePort);
      if (candidatePort !== startPort) {
        console.log(`Port ${startPort} was in use; using ${boundPort} instead.`);
      }
      return { server: candidateServer, port: boundPort };
    } catch (error) {
      candidateServer.close();
      if (!isAddressInUseError(error) || candidatePort === maxPort) {
        throw error;
      }
    }
  }

  throw new Error(`No available port found from ${startPort} to ${maxPort}.`);
}

function createAssistantServer(): ReturnType<typeof createApiServer> {
  return createApiServer(engine, service, {
    app: simpleAssistantApp,
    beforeRoutes: [assistantRoute],
  });
}

function listen(serverToListen: ReturnType<typeof createApiServer>, portToListen: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      serverToListen.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      serverToListen.off("error", onError);
      const address = serverToListen.address();
      resolve(isAddressInfo(address) ? address.port : portToListen);
    };

    serverToListen.once("error", onError);
    serverToListen.once("listening", onListening);
    serverToListen.listen(portToListen, "127.0.0.1");
  });
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}

async function waitForTerminal(threadId: string, waitMs: number) {
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const projection = await engine.getProjection(threadId);
    if (projection?.status === "completed" || projection?.status === "failed") {
      return projection;
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for assistant thread ${threadId}`);
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
  response.end(JSON.stringify(body, null, 2));
}

function describeFailure(events: ThreadEvent[]): string {
  let failure: ThreadEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "tool.failed" || event?.type === "agent.failed" || event?.type === "credential.failed") {
      failure = event;
      break;
    }
  }

  if (!failure) {
    return "No failure event was recorded.";
  }

  switch (failure.type) {
    case "tool.failed":
      return `Tool failed (${failure.payload.errorCode}): ${failure.payload.message}`;
    case "agent.failed":
      return `Agent failed (${failure.payload.errorCode}): ${failure.payload.message}`;
    case "credential.failed":
      return `Credential failed (${failure.payload.errorCode}): ${failure.payload.message}`;
  }

  return "No supported failure event was recorded.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(): Promise<void> {
  await runnerDaemon.stop();
  await toolDaemon.stop();
  server?.close();
  await pool.end();
}
