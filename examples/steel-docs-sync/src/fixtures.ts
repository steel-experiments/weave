import { createServer, type Server } from "node:http";

const docsHtml = `<!doctype html>
<html>
  <body>
    <nav>
      <a href="/reference/api/authentication">Authentication</a>
      <a href="/reference/api/agents">Agents</a>
    </nav>
    <main>
      <h1>Steel Docs</h1>
      <p>API reference and guides.</p>
    </main>
  </body>
</html>`;

const llmsTxt = `# Steel Docs

- /guides/getting-started
- /reference/api/agents
`;

const openApiJson = JSON.stringify(
  {
    openapi: "3.1.0",
    info: { title: "Steel API", version: "1.0.0" },
    paths: {
      "/v1/agents/runs": {
        get: {
          summary: "List agent runs",
        },
      },
      "/v1/authentication/tokens": {
        post: {
          summary: "Create auth token",
        },
      },
    },
  },
  null,
  2,
);

export async function startSteelFixtureServer(): Promise<{ server: Server; baseUrl: string }> {
  let flakyLlmsRequests = 0;

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    switch (path) {
      case "/":
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(docsHtml);
        return;
      case "/llms.txt":
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end(llmsTxt);
        return;
      case "/flaky-llms.txt":
        flakyLlmsRequests += 1;
        if (flakyLlmsRequests <= 2) {
          response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
          response.end("temporary upstream failure");
          return;
        }
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end(llmsTxt);
        return;
      case "/openapi.json":
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(openApiJson);
        return;
      default:
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind to an address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}
