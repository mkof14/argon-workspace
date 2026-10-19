// Shared logic for reports, the notification bell and the morning digest (browser and server).
import type { Rec, Profile } from "./store";

export const DUE_KEYS = ["due", "deadline", "expires", "renewal", "next_service", "valid_until", "eta", "warranty_end", "next_review", "publish", "session", "starts", "book_by"];
export const PEOPLE_KEYS = ["owner", "assignee", "person", "requester", "engineer", "pm_name", "secretary", "holder", "manager", "reviewer"];
export const DONE = /^(done|paid|closed|resolved|installed|signed|filed|delivered|received|cancelled|passed|approved|granted|retired|won|lost|awarded|commissioned|taken|returned|settled|released|registered|minutes signed|revoked|former|answered|not applicable|superseded|rejected|published|adopted|training done|counsel approved|hired|implemented|accepted|declined|archived|reference)$/i;

const today = () => new Date().toISOString().slice(0, 10);
export const dayDiff = (d: string) => Math.round((new Date(String(d).slice(0, 10)).getTime() - new Date(today()).getTime()) / 86400000);

/** A date that stops mattering once the record reaches one of these statuses (e.g. a recording date after recording). */
export const KEY_DONE: Record<string, RegExp> = {
  session: /^(recorded|published|declined)$/i,
  book_by: /^(booked|preparing|done|cancelled)$/i,
  publish: /^(published|declined|archived|done|cancelled)$/i, // an Approved or Scheduled post still needs its date
};

export type DueItem = { r: Rec; k: string; d: number };
/** Open records with a date in the window (negative = overdue). */
export function dueItems(recs: Rec[], within = 30): DueItem[] {
  const out: DueItem[] = [];
  for (const r of recs) {
    const st = r.status || ""; const done = DONE.test(st);
    for (const k of DUE_KEYS) {
      if (KEY_DONE[k] ? KEY_DONE[k].test(st) : done) continue;
      const v = r.data?.[k]; if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) { const d = dayDiff(v); if (d <= within) out.push({ r, k, d }); }
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Does a record name this person (owner, assignee, holder …)? */
export function isMine(r: Rec, me: Pick<Profile, "id" | "email" | "full_name">) {
  if (r.section === "company.tasks" && !r.data?.assignee && r.created_by === me.id) return true;
  // a person picked from the people list is linked to their account (<field>_id): the strongest match
  if (me.id && PEOPLE_KEYS.some((k) => r.data?.[`${k}_id`] === me.id)) return true;
  const keys = [me.email?.toLowerCase(), (me.full_name || "").toLowerCase()].filter((x) => x && x.length > 2) as string[];
  if (!keys.length) return false;
  return PEOPLE_KEYS.some((k) => { const v = String(r.data?.[k] || "").toLowerCase(); return v && keys.some((x) => v.includes(x)); });
}

export const OPEN = (r: Rec) => !DONE.test(r.status || "");
export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
