// The meeting record (minutes) built from the meeting itself: information, attendees, agenda, notes, decisions,
// action items with their tasks, and linked documents. Deterministic — no AI; it becomes the corporate record only
// when the meeting owner approves it.
export type MinutesInput = {
  title: string; date?: string; time?: string; timezone?: string; place?: string; meet_url?: string; project?: string; organizer?: string;
  attendees: string[]; agenda?: string; notes?: string; decisions: { number?: string; text: string }[];
  actions: { title: string; who?: string; due?: string; task?: string | null; taskStatus?: string }[]; documents: { number?: string; title: string; version?: string }[];
};
const clean = (s?: string) => String(s || "").trim();
export function buildMinutes(m: MinutesInput, generatedAt = new Date().toISOString()) {
  const lines: string[] = [`# ${clean(m.title)} — meeting record`, ""];
  lines.push(`- **Date:** ${[m.date, m.time, m.timezone].filter(Boolean).join(" ") || "—"}`);
  if (m.place || m.meet_url) lines.push(`- **Where:** ${[m.place, m.meet_url].filter(Boolean).join(" · ")}`);
  if (m.project) lines.push(`- **Project:** ${m.project}`);
  lines.push(`- **Organizer:** ${m.organizer || "—"}`, `- **Attendees:** ${m.attendees.length ? m.attendees.join(", ") : "—"}`, "");
  lines.push("## Agenda", "", clean(m.agenda) || "—", "", "## Notes", "", clean(m.notes) || "—", "", "## Decisions", "");
  lines.push(...(m.decisions.length ? m.decisions.map((d, i) => `${i + 1}. ${d.number ? `**${d.number}** ` : ""}${clean(d.text)}`) : ["—"]), "", "## Action items", "");
  lines.push(...(m.actions.length ? ["| # | Action | Responsible | Due | Task |", "| --- | --- | --- | --- | --- |", ...m.actions.map((a, i) => `| ${i + 1} | ${clean(a.title).replace(/\|/g, "/")} | ${a.who || "—"} | ${a.due || "—"} | ${a.task ? `${a.task}${a.taskStatus ? ` (${a.taskStatus})` : ""}` : "not created"} |`)] : ["—"]), "");
  lines.push("## Documents", "", ...(m.documents.length ? m.documents.map((d) => `- ${d.number ? `${d.number} · ` : ""}${clean(d.title)}${d.version ? ` · v${d.version}` : ""}`) : ["—"]), "");
  lines.push(`_Generated from the meeting in AGRON Workspace on ${generatedAt.slice(0, 16).replace("T", " ")} UTC. Not the approved record until the meeting owner approves it._`);
  return lines.join("\n");
}
