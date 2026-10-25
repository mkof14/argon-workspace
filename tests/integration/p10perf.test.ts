// P10 §64 — 1inow performance on the isolated stack with a larger synthetic dataset. Measured through the real app
// (HTTP, sign-in cookie, the person's own JWT → PostgREST → engines), not estimated: p50 / p95 / p99 for My Day
// (normal: < 1 s), Executive 1inow and What changed (heavy: < 3 s), Ask (deterministic intents) and a state change.
// This is DEVELOPMENT evidence on a laptop-class container; staging performance is a separate check (P10.PERF.STAGING).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { APP, ENV, makeUser, PASSWORD, sql, uid } from "./_stack.ts";

const run = uid(); const tag = `p10p${run}`; const skipApp = !APP;
const D = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const U: Record<string, any> = {}; const EV: Record<string, any> = { tag, dataset: {}, results: {} };
const N = Number(process.env.P10_PERF_N || 40);
async function cookiesFor(email: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD }); if (error) throw error;
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
async function measure(name: string, fn: () => Promise<Response>, n = N) {
  const ms: number[] = []; let fails = 0;
  for (let i = 0; i < 3; i++) await (await fn()).text(); // warm-up (compilation, caches) — not counted
  for (let i = 0; i < n; i++) { const t = performance.now(); const r = await fn(); await r.text(); ms.push(performance.now() - t); if (!r.ok) fails++; }
  const out = { n, p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(Math.max(...ms)), fails };
  EV.results[name] = out; return out;
}

before(async () => {
  U.eng = await makeUser(`p10pe-${run}@agron-stack.test`, "engineering", { us: true, name: `${tag} Perf Engineer` });
  U.mgmt = await makeUser(`p10pm-${run}@agron-stack.test`, "management", { us: true, name: `${tag} Perf Manager` });
  // a larger dataset: 40 projects, 2,400 tasks (300 for the measured engineer), 120 meetings today, comments, waits
  await sql(`insert into records(section, title, status, data, created_by)
    select 'company.projects', '${tag} Project ' || g, 'Active', jsonb_build_object('owner_id', $1::text), $1::uuid from generate_series(1, 40) g`, [U.mgmt.id]);
  await sql(`insert into records(section, title, status, data, created_by)
    select 'company.tasks', '${tag} Task ' || g, (array['New','In Progress','Waiting','To Do'])[1 + g % 4],
      jsonb_build_object('assignee_id', case when g % 8 = 0 then $1::text else $2::text end, 'due', (current_date + ((g % 21) - 7))::text, 'priority', (array['Normal','High','Low'])[1 + g % 3],
        'waiting_kind', case when g % 4 = 2 then 'Supplier' end, 'waiting_on', case when g % 4 = 2 then '${tag} Vendor ' || (g % 9) end), $2::uuid
    from generate_series(1, 2400) g`, [U.eng.id, U.mgmt.id]);
  await sql(`insert into records(section, title, status, data, created_by)
    select 'company.meetings', '${tag} Meeting ' || g, 'Planned', jsonb_build_object('date', current_date::text, 'time', lpad((8 + g % 10)::text, 2, '0') || ':00', 'timezone', 'UTC',
      'organizer_id', $2::text, 'participants_ids', jsonb_build_array($1::text, $2::text)), $2::uuid from generate_series(1, 120) g`, [U.eng.id, U.mgmt.id]);
  await sql(`insert into comments(record_id, author, body) select id, $1::uuid, 'I will send the update tomorrow — ' || title from records where title like '${tag} Task %' and data->>'assignee_id' = $1::text limit 60`, [U.eng.id]);
  EV.dataset = (await sql("select section, count(*)::int n from records where title like $1 group by 1 order by 1", [`${tag}%`]));
  EV.dataset_total_records = (await sql("select count(*)::int n from records"))[0].n;
});

test("§64 My Day < 1 s, Executive and changes < 3 s (p95), measured through the app", { skip: skipApp && "no app" }, async () => {
  const ce = await cookiesFor(U.eng.email), cm = await cookiesFor(U.mgmt.email);
  const get = (ck: string, q: string) => () => fetch(`${APP}/api/inow?${q}`, { headers: { cookie: ck } });
  const post = (ck: string, body: any) => () => fetch(`${APP}/api/inow`, { method: "POST", headers: { cookie: ck, "Content-Type": "application/json", origin: APP }, body: JSON.stringify(body) });
  const day = await measure("my_day_engineer", get(ce, "view=day"));
  const dayM = await measure("my_day_manager", get(cm, "view=day"));
  const ex = await measure("executive", get(cm, "view=executive"), Math.ceil(N / 2));
  const ch = await measure("changes_week", get(cm, "view=changes&window=week"), Math.ceil(N / 2));
  const ask = await measure("ask_attention", post(ce, { op: "ask", q: "What needs my attention?", lang: "en" }), Math.ceil(N / 2));
  const st = await measure("state_pin", post(ce, { op: "state", key: "task:perf", pin: true }), Math.ceil(N / 2));
  const body = await (await fetch(`${APP}/api/inow?view=day`, { headers: { cookie: ce } })).json();
  EV.items_in_day = Object.fromEntries(Object.entries(body.counts || {})); EV.server_ms_last = body.ms;
  for (const [n, r] of Object.entries({ day, dayM, ask, st })) { assert.equal(r.fails, 0, n); assert.ok(r.p95 < 1000, `${n}: p95 ${r.p95} ms ≥ 1 s`); }
  for (const [n, r] of Object.entries({ ex, ch })) { assert.equal(r.fails, 0, n); assert.ok(r.p95 < 3000, `${n}: p95 ${r.p95} ms ≥ 3 s`); }
});

// the larger dataset is removed afterwards, so later suites (and their own performance budgets) see the usual stack
after(async () => {
  await sql("delete from comments where record_id in (select id from records where title like $1)", [`${tag}%`]).catch(() => null);
  await sql("delete from records where title like $1", [`${tag}%`]).catch(() => null);
});

test("evidence file", () => {
  fs.mkdirSync(path.join(process.cwd(), ".stack"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".stack", "p10perf.json"), JSON.stringify(EV, null, 1));
});
