import { slaFor } from "@/lib/sla";
import { claimKeys } from "./state";
import { pushTo } from "./push";

// Every 15 minutes (with the schedule key) or daily: a phone signal to the service team when a request passes its SLA time.
const T: Record<string, Record<"en" | "ru" | "uk" | "ar", string>> = {
  resp: { en: "SLA: no response yet", ru: "SLA: нет ответа клиенту", uk: "SLA: немає відповіді клієнту", ar: "SLA: لا رد بعد" },
  res: { en: "SLA: not resolved in time", ru: "SLA: не решено в срок", uk: "SLA: не вирішено вчасно", ar: "SLA: لم يُحل في الوقت" },
};
export async function slaJob(db: any) {
  const { data: recs } = await db.from("records").select("id,section,title,status,data,controlled,created_at").in("section", ["operations.support", "operations.fleet"]).limit(5000);
  const fleet = (recs || []).filter((r: any) => r.section === "operations.fleet");
  const { data: people } = await db.from("profiles").select("id,role,us_person").in("role", ["operations", "owner", "admin", "management"]);
  let sent = 0;
  // each late request is announced once per kind; the key is claimed in the database before the signal goes out
  const late: { t: any; v: any; kind: "resp" | "res"; key: string }[] = [];
  for (const t of (recs || []).filter((r: any) => r.section === "operations.support")) {
    const v = slaFor(t, fleet); if (!v) continue;
    for (const kind of ["resp", "res"] as const) if (kind === "resp" ? v.respond === "late" : v.respond !== "late" && v.resolve === "late") late.push({ t, v, kind, key: `sla|${kind}|${t.id}` });
  }
  const mine = await claimKeys(db, late.map((x) => ({ key: x.key, repeat: null })));
  for (const { t, v, kind, key } of late) {
    {
      if (!mine.has(key)) continue;
      const to = (people || []).filter((p: any) => (p.role === "operations" || (v.severity === "Critical" || kind === "res")) && (!t.controlled || p.us_person)).map((p: any) => p.id);
      sent += await pushTo(db, to, (l) => ({ title: T[kind][l], body: `${t.controlled ? "US-persons-only record" : t.title} · ${v.severity} · ${v.tier}`, url: `/operations/support?r=${t.id}`, tag: `sla-${key}` })).catch(() => 0);
    }
  }
  return { checked: (recs || []).length, sent };
}
