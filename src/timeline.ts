import type { MailboxEvent } from "./events.js";

export function toTextTimeline(events: MailboxEvent[]): string {
  return events.map((event) => `${String(event.seq).padStart(2, "0")} ${event.type}`).join("\n");
}

export function toMermaidTimeline(events: MailboxEvent[]): string {
  const lines = ["flowchart TD"];

  for (const event of events) {
    const nodeId = `E${event.seq ?? 0}`;
    const seq = String(event.seq).padStart(2, "0");
    const actor = `${event.actor.type}:${event.actor.id}`;
    lines.push(`  ${nodeId}["${escapeMermaidLabel(`${seq} ${event.type}\n${actor}`)}"]`);
  }

  for (let index = 0; index < events.length - 1; index += 1) {
    const current = events[index];
    const next = events[index + 1];
    if (current?.seq === undefined || next?.seq === undefined) {
      continue;
    }
    lines.push(`  E${current.seq} --> E${next.seq}`);
  }

  return lines.join("\n");
}

function escapeMermaidLabel(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/"/g, "'");
}
