import { slaFor } from "@/lib/sla";
import { readState, saveState } from "./backup";
import { pushTo } from "./push";

// Every 15 minutes (with the schedule key) or daily: a phone signal to the service team when a request passes its SLA time.
const T: Record<string, Record<"en" | "ru" | "uk" | "ar", string>> = {
  resp: { en: "SLA: no response yet", ru: "SLA: нет ответа клиенту", uk: "SLA: немає відповіді клієнту", ar: "SLA: لا رد بعد" },
  res: { en: "SLA: not resolved in time", ru: "SLA: не решено в срок", uk: "SLA: не вирішено вчасно", ar: "SLA: لم يُحل في الوقت" },
};
export async function slaJob(db: any) {
  const { data: recs } = await db.from("records").select("id,section,title,status,data,controlled,created_at").in("section", ["operations.support", "operations.fleet"]).limit(5000);
  const fleet = (recs || []).filter((r: any) => r.section === "operations.fleet");
  const fired: Record<string, string> = (await readState(db, "sla-fired").catch(() => null)) || {};
  const { data: people } = await db.from("profiles").select("id,role,us_person").in("role", ["operations", "owner", "admin", "management"]);
  let sent = 0;
  for (const t of (recs || []).filter((r: any) => r.section === "operations.support")) {
    const v = slaFor(t, fleet); if (!v) continue;
    for (const kind of ["resp", "res"] as const) {
      const late = kind === "resp" ? v.respond === "late" : v.respond !== "late" && v.resolve === "late";
      const key = `${kind}|${t.id}`; if (!late || fired[key]) continue;
      fired[key] = new Date().toISOString();
      const to = (people || []).filter((p: any) => (p.role === "operations" || (v.severity === "Critical" || kind === "res")) && (!t.controlled || p.us_person)).map((p: any) => p.id);
      sent += await pushTo(db, to, (l) => ({ title: T[kind][l], body: `${t.controlled ? "US-persons-only record" : t.title} · ${v.severity} · ${v.tier}`, url: `/operations/support?r=${t.id}`, tag: `sla-${key}` })).catch(() => 0);
    }
  }
  // forget requests that no longer exist or were closed long ago
  const ids = new Set((recs || []).map((r: any) => r.id));
  for (const k of Object.keys(fired)) if (!ids.has(k.split("|")[1])) delete fired[k];
  await saveState(db, "sla-fired", fired);
  return { checked: (recs || []).length, sent };
}
