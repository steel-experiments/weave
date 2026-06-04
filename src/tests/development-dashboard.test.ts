import assert from "node:assert/strict";
import { dashboardHtml, createLocalDashboardServer } from "../development-dashboard.js";

const html = dashboardHtml();
assert.match(html, /Workflow Console/);
assert.match(html, /Sleek|gates:list|initiative:status/);
assert.match(html, /#0b1326/);
assert.match(html, /JetBrains Mono/);
assert.match(html, /\/api\/state/);
assert.match(html, /\/api\/gates\//);

const server = createLocalDashboardServer({ pool: {} as never, service: {} as never });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Workflow Console/);
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

console.log("Development dashboard tests passed");
