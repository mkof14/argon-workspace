// Phase 3 performance on the isolated stack with a realistic volume: 50+ people, 100 projects, 5,000 messages,
// 10,000 notifications, 1,000 mentions. Every number is measured here through the real API with a signed-in person
// (PostgREST + row-level security), median and 90th percentile of repeated calls. Synthetic data only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeUser, signIn, sql, uid } from "./_stack.ts";

const run = uid(); const N = { users: 52, projects: 100, messages: 5000, notifications: 10000, mentions: 1000 };
const people: any[] = []; let me: any, C: any, projects: string[] = [], ann: string;
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { median: Math.round(s[Math.floor(s.length / 2)]), p90: Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]), n: s.length }; };
async function time(n: number, f: (i: number) => Promise<any>) { const out: number[] = []; for (let i = 0; i < n; i++) { const t = performance.now(); const r = await f(i); if (r?.error) throw new Error(r.error.message); out.push(performance.now() - t); } return stats(out); }
const results: Record<string, any> = {};

before(async () => {
  for (let i = 0; i < N.users; i++) people.push(await makeUser(`perf${i}-${run}@agron-stack.test`, i === 0 ? "management" : ["engineering", "operations", "finance"][i % 3], { us: true, name: `Perf ${i} ${run}` }));
  await sql("update profiles set department = case when role = 'engineering' then 'Eng' || $2 else 'Other' || $2 end where email like $1", [`perf%-${run}@agron-stack.test`, run]);
  me = people[1]; C = (await signIn(me.email)).c;
  const ids = people.map((p) => p.id);
  // projects, each with a manager and five members
  projects = (await sql(`insert into records(section, title, status, data, created_by)
      select 'company.projects', 'Perf project ' || g || ' ${run}', 'Active',
        jsonb_build_object('manager_id', ($1::uuid[])[1 + g % $2], 'members_ids', to_jsonb(array[($1::uuid[])[1 + (g + 1) % $2], ($1::uuid[])[1 + (g + 2) % $2], ($1::uuid[])[1 + (g + 3) % $2], ($1::uuid[])[2], ($1::uuid[])[1 + (g + 5) % $2]]::text[])), ($1::uuid[])[1]
      from generate_series(1, ${N.projects}) g returning id`, [ids, ids.length])).map((r: any) => r.id);
  // 5,000 messages, 1,000 of them with a mention (the database parses the mention from the text and notifies)
  await sql(`insert into comments(record_id, author, body, created_at)
      select ($1::uuid[])[1 + g % ${N.projects}], ($2::uuid[])[1 + g % $3],
        'Perf message ' || g || ' about torque and wiring harness ' || md5(g::text) || case when g % 5 = 0 then ' @[Perf](' || ($2::uuid[])[1 + (g * 7) % $3] || ')' else '' end,
        now() - make_interval(mins => ${N.messages} - g)
      from generate_series(1, ${N.messages}) g`, [projects, ids, ids.length]);
  // top up to 10,000 notifications in total for these people (assignments, status, comments …)
  const [{ n }] = await sql("select count(*)::int n from notifications where user_id = any($1)", [ids]);
  await sql(`insert into notifications(user_id, kind, record_id, section, title, body, key, created_at, read_at)
      select ($1::uuid[])[1 + g % $2], (array['assigned','status','comment','due_soon'])[1 + g % 4], ($3::uuid[])[1 + g % ${N.projects}], 'company.projects', 'Perf', 'x', 'perf:${run}:' || g,
        now() - make_interval(mins => g), case when g % 3 = 0 then now() end
      from generate_series(1, greatest(0, ${N.notifications} - $4)) g`, [ids, ids.length, projects, n]);
  ann = (await sql(`insert into records(section, title, status, data, created_by) values ('company.announcements', 'Perf announcement ${run}', 'Published',
      jsonb_build_object('message', 'All hands', 'audience_type', 'department', 'audience', 'Eng${run}', 'publish_at', to_char(now(), 'YYYY-MM-DD'), 'ack_required', true), $1) returning id`, [people[0].id]))[0].id;
});

test("volume is in place", async () => {
  const ids = people.map((p) => p.id);
  const [v] = await sql(`select (select count(*)::int from profiles where id = any($1)) users, (select count(*)::int from records where section = 'company.projects' and title like $2) projects,
      (select count(*)::int from comments where record_id = any($3)) messages, (select count(*)::int from notifications where user_id = any($1)) notifications,
      (select count(*)::int from comments where record_id = any($3) and cardinality(mentions) > 0) mentions`, [ids, `Perf project % ${run}`, projects]);
  results.volume = v;
  assert.ok(v.users >= 50 && v.projects >= 100 && v.messages >= 5000 && v.notifications >= 10000 && v.mentions >= 1000, JSON.stringify(v));
});

test("measured: notification centre, discussion, search, post, mark read, announcement audience", async () => {
  results.notification_centre = await time(20, () => C.from("notifications").select("id,kind,record_id,section,title,body,actor,link,created_at,read_at,critical").order("created_at", { ascending: false }).limit(100));
  results.unread_count = await time(20, () => C.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null));
  results.project_discussion = await time(20, (i) => C.from("comments").select("*").eq("record_id", projects[i % projects.length]).order("created_at"));
  results.search = await time(20, (i) => C.rpc("search_messages", { p_q: ["torque", "harness", "wiring torque", "message 42"][i % 4] }));
  results.post_message = await time(20, (i) => C.from("comments").insert({ record_id: projects[i], body: `Timed post ${i} @[Perf](${people[2 + i].id})` }).select("id").single());
  results.mark_read = await time(20, async (i) => { const { data } = await C.from("notifications").select("id").is("read_at", null).limit(1); return C.from("notifications").update({ read_at: new Date().toISOString() }).in("id", (data || []).map((x: any) => x.id)); });
  results.mark_all_read = await time(3, () => C.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null));
  const M = (await signIn(people[0].email)).c;
  results.announcement_audience = await time(20, () => M.rpc("announcement_stats", { p_id: ann }));
  results.announcement_publish_dispatch = await time(5, () => sql("select public.announcement_dispatch($1)", [ann]));
  results.mention_suggestions = await time(20, (i) => C.rpc("mention_candidates", { p_record: projects[i], p_q: "Perf" }));
  const st = (await M.rpc("announcement_stats", { p_id: ann })).data; assert.ok(st.audience >= 17, `audience ${st.audience}`);
  results.audience_size = st.audience;
  fs.mkdirSync(path.join(process.env.STACK_DIR!, ".."), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".stack", "comms-perf.json"), JSON.stringify(results, null, 1));
  console.log("PERF", JSON.stringify(results));
  for (const k of ["notification_centre", "project_discussion", "search", "post_message", "mark_read", "announcement_audience"]) assert.ok(results[k].p90 < 3000, `${k} p90 ${results[k].p90} ms`);
});
