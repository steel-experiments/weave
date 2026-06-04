import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import { z } from "zod";
import { DevelopmentCheckpointKeys } from "./development-orchestrator.js";
import {
  getInitiativeStatus,
  listInitiatives,
  listPendingGates,
  resolveOperatorGate,
  type OperatorGateSummary,
  type OperatorInitiativeStatus,
  type OperatorInitiativeSummary,
} from "./development-operator.js";
import { ThreadEventSchema, type ThreadEvent } from "./events.js";
import type { ThreadService } from "./thread-service.js";

export const DashboardStateSchema = z.object({
  initiatives: z.array(z.unknown()),
  gates: z.array(z.unknown()),
  selected: z.unknown().optional(),
  toolEvents: z.array(
    z.object({
      threadId: z.string().min(1),
      seq: z.number().int().nonnegative().optional(),
      type: z.string().min(1),
      label: z.string().min(1),
      detail: z.string().optional(),
      occurredAt: z.string().min(1),
    }),
  ),
  handoff: z.unknown().optional(),
});
export type DashboardState = {
  initiatives: OperatorInitiativeSummary[];
  gates: OperatorGateSummary[];
  selected?: OperatorInitiativeStatus;
  toolEvents: Array<z.infer<typeof DashboardStateSchema>["toolEvents"][number]>;
  handoff?: unknown;
};

export type LocalDashboardOptions = {
  pool: Pool;
  service: ThreadService;
};

export function createLocalDashboardServer(options: LocalDashboardOptions): Server {
  return createServer(async (request, response) => {
    try {
      await routeDashboardRequest(options, request, response);
    } catch (error) {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export async function buildDashboardState(pool: Pool, threadId?: string): Promise<DashboardState> {
  const [initiatives, gates] = await Promise.all([listInitiatives(pool), listPendingGates(pool)]);
  const selectedThreadId = threadId ?? initiatives[0]?.threadId;
  const selected = selectedThreadId ? await getInitiativeStatus(pool, selectedThreadId) : undefined;
  const [toolEvents, handoff] = selected
    ? await Promise.all([listToolEventsForInitiative(pool, selected.threadId), latestHandoffForInitiative(pool, selected.threadId)])
    : [[], undefined] as const;

  return DashboardStateSchema.parse({ initiatives, gates, selected, toolEvents, handoff }) as DashboardState;
}

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Weave Workflow Dashboard</title>
  <style>${dashboardCss()}</style>
</head>
<body>
  <main class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"></span>
        <div>
          <p class="eyebrow">Weave</p>
          <h1>Workflow Console</h1>
        </div>
      </div>
      <div class="command-map">
        <span>Mirrors CLI</span>
        <code>gates:list</code>
        <code>initiative:status</code>
      </div>
      <section class="panel compact">
        <div class="panel-title">Initiatives</div>
        <div id="initiatives" class="list muted">Loading...</div>
      </section>
    </aside>
    <section class="main-grid">
      <section class="hero panel">
        <div>
          <p class="eyebrow">Localhost Only</p>
          <h2 id="initiative-title">No initiative selected</h2>
          <p id="initiative-meta" class="muted">Waiting for durable workflow state.</p>
        </div>
        <button id="refresh">Refresh</button>
      </section>
      <section class="panel span-2">
        <div class="panel-title">Execution Nodes</div>
        <div id="children" class="node-grid muted">No child threads.</div>
      </section>
      <section class="panel">
        <div class="panel-title">Pending Gates</div>
        <div id="gates" class="list muted">No pending gates.</div>
      </section>
      <section class="panel">
        <div class="panel-title">Live Tool Progress</div>
        <div id="tools" class="log muted">No recent tool events.</div>
      </section>
      <section class="panel span-2">
        <div class="panel-title">PR Handoff</div>
        <pre id="handoff" class="payload">No handoff artifact yet.</pre>
      </section>
      <section class="panel span-2">
        <div class="panel-title">Recent Events</div>
        <div id="events" class="log muted">No events.</div>
      </section>
    </section>
  </main>
  <script>${dashboardScript()}</script>
</body>
</html>`;
}

async function routeDashboardRequest(options: LocalDashboardOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/") {
    writeHtml(response, dashboardHtml());
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    writeJson(response, 200, await buildDashboardState(options.pool, url.searchParams.get("threadId") ?? undefined));
    return;
  }

  const gateResolveMatch = url.pathname.match(/^\/api\/gates\/([^/]+)\/resolve$/);
  if (method === "POST" && gateResolveMatch) {
    const body = z.object({ resolution: z.enum(["approved", "denied"]), note: z.string().optional() }).parse(await readJson(request));
    writeJson(response, 200, await resolveOperatorGate({
      pool: options.pool,
      service: options.service,
      gateId: decodeURIComponent(gateResolveMatch[1] ?? ""),
      resolution: body.resolution,
      note: body.note,
    }));
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

async function listToolEventsForInitiative(pool: Pool, rootThreadId: string): Promise<DashboardState["toolEvents"]> {
  const events = await eventJsonRows(pool, rootThreadId, ["tool.started", "tool.progress", "tool.completed", "tool.failed"], 50);
  return events.map((event) => ({
    threadId: event.threadId,
    seq: event.seq,
    type: event.type,
    label: toolEventLabel(event),
    detail: toolEventDetail(event),
    occurredAt: event.occurredAt,
  }));
}

async function latestHandoffForInitiative(pool: Pool, rootThreadId: string): Promise<unknown | undefined> {
  const events = await eventJsonRows(pool, rootThreadId, ["checkpoint.completed"], 100);
  const handoff = events.find((event) => event.type === "checkpoint.completed" && (event.payload.stepKey === DevelopmentCheckpointKeys.prRemoteHandoff || event.payload.stepKey === DevelopmentCheckpointKeys.prHandoff));
  return handoff?.type === "checkpoint.completed" ? handoff.payload.value : undefined;
}

async function eventJsonRows(pool: Pool, rootThreadId: string, types: readonly string[], limit: number): Promise<ThreadEvent[]> {
  const result = await pool.query<{ event_json: unknown }>(
    `select jsonb_build_object(
       'eventId', e.event_id::text,
       'threadId', e.thread_id,
       'seq', e.seq,
       'type', e.type,
       'occurredAt', e.occurred_at,
       'correlationId', e.correlation_id::text,
       'causationId', e.causation_id::text,
       'idempotencyKey', e.idempotency_key,
       'scopeKey', e.scope_key,
       'stepKey', e.step_key,
       'actor', jsonb_build_object('type', e.actor_type, 'id', e.actor_id),
       'payload', e.payload_json
     ) as event_json
     from weave.thread_event e
     join weave.thread t on t.id = e.thread_id
     where (t.id = $1 or t.root_thread_id = $1)
       and e.type = any($2::text[])
     order by e.occurred_at desc, e.seq desc
     limit $3`,
    [rootThreadId, [...types], limit],
  );
  return result.rows.map((row) => ThreadEventSchema.parse(row.event_json));
}

function toolEventLabel(event: ThreadEvent): string {
  if (event.type === "tool.started") {
    return event.payload.toolName;
  }
  if (event.type === "tool.progress") {
    return `${event.payload.percent}%`;
  }
  if (event.type === "tool.failed") {
    return event.payload.errorCode;
  }
  if (event.type === "tool.completed") {
    return "completed";
  }
  return event.type;
}

function toolEventDetail(event: ThreadEvent): string | undefined {
  if (event.type === "tool.progress") {
    return event.payload.message;
  }
  if (event.type === "tool.failed") {
    return event.payload.message;
  }
  if (event.type === "tool.completed") {
    return event.payload.summary;
  }
  return undefined;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function dashboardCss(): string {
  return `:root{color-scheme:dark;--bg:#0b1326;--low:#131b2e;--panel:#171f33;--panel-hi:#222a3d;--edge:#464554;--text:#dae2fd;--muted:#c7c4d7;--primary:#c0c1ff;--primary-strong:#8083ff;--cyan:#5de6ff;--danger:#ffb4ab;--ok:#10b981;--warn:#f59e0b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,#1b2550 0,#0b1326 34rem);color:var(--text);font:14px/1.5 Geist,Inter,system-ui,sans-serif}.shell{display:grid;grid-template-columns:320px 1fr;gap:16px;min-height:100vh;padding:24px}.sidebar,.panel{background:linear-gradient(180deg,rgba(23,31,51,.92),rgba(19,27,46,.88));border:1px solid rgba(199,196,215,.16);border-radius:8px;backdrop-filter:blur(20px)}.sidebar{padding:16px;display:flex;flex-direction:column;gap:16px}.brand{display:flex;gap:12px;align-items:center}.brand-mark{width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,var(--primary),var(--cyan));box-shadow:0 0 30px rgba(93,230,255,.18)}h1,h2{margin:0;letter-spacing:-.01em}h1{font-size:18px}h2{font-size:28px}.eyebrow,.panel-title,.chip{font:600 11px/1 JetBrains Mono,monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--cyan)}.main-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.panel{padding:16px;min-width:0}.hero{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between}.span-2{grid-column:1/-1}.compact{padding:12px}.muted{color:var(--muted)}button{border:1px solid rgba(93,230,255,.36);background:rgba(93,230,255,.12);color:var(--text);border-radius:4px;padding:8px 10px;font:600 12px/1 JetBrains Mono,monospace;cursor:pointer}button.primary{background:var(--primary);color:#1000a9;border-color:var(--primary)}button.danger{background:rgba(255,180,171,.14);border-color:rgba(255,180,171,.45);color:var(--danger)}.list,.log{display:grid;gap:8px;margin-top:12px}.row,.node{border:1px solid rgba(199,196,215,.12);background:rgba(6,14,32,.55);border-radius:6px;padding:10px}.row.active{border-color:var(--primary);background:rgba(128,131,255,.16)}.node{border-left:3px solid var(--primary-strong)}.node.running{border-left-color:var(--cyan)}.node.completed{border-left-color:var(--ok)}.node.failed,.node.blocked{border-left-color:var(--danger)}.row-title{font-weight:700}.mono,code,.payload,.log{font-family:JetBrains Mono,ui-monospace,monospace}.payload{white-space:pre-wrap;overflow:auto;background:#060e20;border:1px solid rgba(199,196,215,.12);border-radius:6px;padding:12px;max-height:320px}.command-map{display:flex;flex-wrap:wrap;gap:8px}.command-map span{width:100%;color:var(--muted)}code{background:#060e20;border:1px solid rgba(199,196,215,.12);border-radius:999px;padding:5px 7px;color:var(--primary)}.actions{display:flex;gap:8px;margin-top:8px}@media(max-width:900px){.shell{grid-template-columns:1fr;padding:12px}.main-grid{grid-template-columns:1fr}.span-2,.hero{grid-column:auto}.hero{align-items:flex-start;gap:16px;flex-direction:column}}`;
}

function dashboardScript(): string {
  return `let selectedThreadId;async function load(){const q=selectedThreadId?'?threadId='+encodeURIComponent(selectedThreadId):'';const res=await fetch('/api/state'+q);const state=await res.json();render(state)}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function render(state){if(!selectedThreadId&&state.selected)selectedThreadId=state.selected.threadId;document.getElementById('initiatives').innerHTML=state.initiatives.length?state.initiatives.map(i=>'<div class="row '+(i.threadId===selectedThreadId?'active':'')+'" data-thread="'+esc(i.threadId)+'"><div class="row-title">'+esc(i.title||i.threadId)+'</div><div class="mono">'+esc(i.status)+' gates='+esc(i.pendingGateCount)+'</div><div class="muted">'+esc(i.workingBranch||'')+'</div></div>').join(''):'No initiatives found.';document.querySelectorAll('[data-thread]').forEach(el=>el.onclick=()=>{selectedThreadId=el.getAttribute('data-thread');load()});const s=state.selected;document.getElementById('initiative-title').textContent=s?(s.title||s.threadId):'No initiative selected';document.getElementById('initiative-meta').textContent=s?('thread='+s.threadId+' status='+s.status+' branch='+(s.workingBranch||'n/a')):'Waiting for durable workflow state.';document.getElementById('children').innerHTML=s&&s.childThreads.length?s.childThreads.map(c=>'<div class="node '+esc(c.status)+'"><div class="row-title">'+esc(c.agentName||c.threadId)+'</div><div class="mono">'+esc(c.status)+' '+esc(c.threadId)+'</div></div>').join(''):'No child threads.';document.getElementById('gates').innerHTML=state.gates.length?state.gates.map(g=>'<div class="row"><div class="row-title">'+esc(g.reason||g.gateType)+'</div><div class="mono">'+esc(g.gateId)+'</div><div>'+esc(g.proposedAction||'')+'</div><div class="actions"><button class="primary" data-approve="'+esc(g.gateId)+'">Approve</button><button class="danger" data-reject="'+esc(g.gateId)+'">Reject</button></div></div>').join(''):'No pending gates.';document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>resolveGate(b.getAttribute('data-approve'),'approved'));document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>resolveGate(b.getAttribute('data-reject'),'denied'));document.getElementById('tools').innerHTML=state.toolEvents.length?state.toolEvents.map(e=>'<div class="row"><span class="chip">'+esc(e.type)+'</span> <span class="mono">'+esc(e.label)+'</span><div>'+esc(e.detail||'')+'</div></div>').join(''):'No recent tool events.';document.getElementById('handoff').textContent=state.handoff?JSON.stringify(state.handoff,null,2):'No handoff artifact yet.';document.getElementById('events').innerHTML=s&&s.recentEvents.length?s.recentEvents.map(e=>'<div class="row"><span class="mono">#'+esc(e.seq)+' '+esc(e.type)+'</span><div class="muted">'+esc(e.actor)+'</div></div>').join(''):'No events.'}async function resolveGate(gateId,resolution){const note=prompt(resolution==='approved'?'Approval note':'Rejection reason');if(note===null)return;if(!confirm(resolution+' gate '+gateId+'?'))return;await fetch('/api/gates/'+encodeURIComponent(gateId)+'/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resolution,note})});await load()}document.getElementById('refresh').onclick=load;load();setInterval(load,5000);`;
}
