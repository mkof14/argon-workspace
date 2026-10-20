// Phase 3 — communications, checked against the real database rules (v20) with real sign-ins on the isolated stack.
// Scenarios 1–10 of the Phase 3 test plan: project discussion, a restricted (controlled) project, an external partner,
// document review across versions, announcement acknowledgement with a changed text, meeting action → task (once),
// notification delivery with two workers at once, e-mail success / failure / uncertain, session revocation and search.
// Roles: Owner, Admin, Management, Project Manager, Employee, Engineering, Operations, Finance, Partner, Vendor,
// Non-US internal. Synthetic people and data only.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { admin, clearMail, makeUser, mails, mailsTo, signIn, sql, uid } from "./_stack.ts";
import { deliverNotifications } from "../../src/lib/server/notify.ts";

const db = admin(); const run = uid();
const U: Record<string, any> = {};
const C: Record<string, any> = {};
const notes = async (user: string, record?: string) => sql(`select kind, key, link, email_state, critical from notifications where user_id = $1 ${record ? "and record_id = $2" : ""} order by id`, record ? [user, record] : [user]);
const M = (u: any) => `@[${u.name}](${u.id})`;
const people: [string, string, { us?: boolean; company?: string; dept?: string }][] = [
  ["owner", "owner", { us: true }], ["admin", "admin", { us: true }], ["mgmt", "management", { us: true, dept: "Management" }],
  ["pm", "engineering", { us: true, dept: `Eng ${run}` }], ["emp", "operations", { us: true, dept: "Operations" }],
  ["eng", "engineering", { us: true, dept: `Eng ${run}` }], ["ops", "operations", { dept: "Operations" }], ["fin", "finance", { us: true, dept: "Finance" }],
  ["pat", "partner", { company: `Acme ${run}` }], ["ven", "vendor", { company: `Bolt ${run}` }], ["nonus", "engineering", { us: false, dept: `Eng ${run}` }],
];
let P: any; // the main project
before(async () => {
  for (const [k, role, o] of people) {
    const name = `${k[0].toUpperCase()}${k.slice(1)} ${run}`;
    const u = await makeUser(`c${k}-${run}@agron-stack.test`, role, { us: o.us, company: o.company, name });
    if (o.dept) await db.from("profiles").update({ department: o.dept }).eq("id", u.id);
    U[k] = { ...u, name }; C[k] = (await signIn(u.email)).c;
  }
  const { data, error } = await C.mgmt.from("records").insert({ section: "company.projects", title: `StarDome C40 ${run}`, status: "Active", company: `Acme ${run}`,
    data: { manager_id: U.pm.id, manager: U.pm.name, members_ids: [U.emp.id, U.eng.id], members: [U.emp.name, U.eng.name] } }).select("*").single();
  assert.ifError(error); P = data;
});

/* 1 ------------------------------------------------------------------------------------------------------------ */
test("1. project discussion: messages, replies, mentions by account, edit and withdraw with history, marks and decisions", async () => {
  // a forged author, a forged flag and a forged kind are replaced by the database
  const { data: m1, error } = await C.emp.from("comments").insert({ record_id: P.id, body: `Supplier quote is in. ${M(U.eng)} please check the wiring. ${M(U.ven)} ${M({ name: "Ghost", id: "00000000-0000-4000-8000-000000000000" })}`,
    author: U.owner.id, flag: "decision", kind: "system", pinned_at: new Date().toISOString() }).select("*").single();
  assert.ifError(error);
  assert.equal(m1.author, U.emp.id, "author is the signed-in person"); assert.equal(m1.flag, null); assert.equal(m1.kind, "message"); assert.equal(m1.pinned_at, null);
  assert.deepEqual(m1.mentions, [U.eng.id], "only real people who may read the project are mentioned (not a vendor of another company, not an unknown id)");
  assert.deepEqual(m1.mention_names, [{ id: U.eng.id, name: U.eng.name }], "the name at the time is stored");
  // notifications: the engineer is mentioned once; the project manager hears about a project message; nobody twice
  const talk = async (u: string) => (await notes(u, P.id)).filter((n: any) => n.kind !== "project_member");
  assert.deepEqual((await talk(U.eng.id)).map((n: any) => n.kind), ["mention"], "mentioned once, not also as a team member");
  const pmN = await talk(U.pm.id); assert.deepEqual(pmN.map((n: any) => n.kind), ["project_message"]);
  assert.match(pmN[0].link, new RegExp(`^/projects/${P.id}\\?tab=discussion#c-${m1.id}$`), "the notification opens the exact message");
  assert.equal((await notes(U.ven.id)).length, 0, "no notification for a forged mention");
  // a reply (to a reply goes to the same thread, one level)
  const { data: r1 } = await C.eng.from("comments").insert({ record_id: P.id, parent_id: m1.id, body: "Checked — two connectors are wrong." }).select("*").single();
  const { data: r2 } = await C.pm.from("comments").insert({ record_id: P.id, parent_id: r1.id, body: "Thanks, ordering new ones." }).select("*").single();
  assert.equal(r2.parent_id, m1.id, "replies stay one level deep");
  assert.ok((await notes(U.emp.id, P.id)).some((n: any) => n.kind === "reply"), "the author hears about a reply");
  const { data: elsewhere } = await C.pm.from("records").insert({ section: "company.tasks", title: `Elsewhere ${run}`, status: "New", data: { assignee_id: U.pm.id } }).select("id").single();
  const { data: ec } = await C.pm.from("comments").insert({ record_id: elsewhere.id, body: "other thread" }).select("id").single();
  const other = await C.pm.from("comments").insert({ record_id: P.id, parent_id: ec.id, body: "cross" }).select("*");
  assert.match(String(other.error?.message), /same discussion/, "a reply cannot jump to another discussion");
  // edit own (history kept), nobody else's
  assert.ifError((await C.emp.from("comments").update({ body: `Supplier quote is in (rev B). ${M(U.eng)}` }).eq("id", m1.id)).error);
  const [e1] = await sql("select body, edited_at, author from comments where id = $1", [m1.id]); assert.ok(e1.edited_at); assert.match(e1.body, /rev B/); assert.equal(e1.author, U.emp.id);
  assert.equal((await sql("select count(*)::int n from comment_revisions where comment_id = $1 and action = 'edit'", [m1.id]))[0].n, 1);
  const theirs = await C.eng.from("comments").update({ body: "hijack" }).eq("id", m1.id).select("id");
  assert.ok(theirs.error || !theirs.data?.length, "someone else cannot edit"); assert.match((await sql("select body from comments where id = $1", [m1.id]))[0].body, /rev B/);
  const meta = await C.emp.from("comments").update({ flag: "decision" }).eq("id", m1.id).select("id");
  assert.ok(meta.error, "marks cannot be set by editing");
  const rev = await C.emp.from("comment_revisions").select("*"); assert.ok(rev.error || !rev.data?.length, "the edit history is not readable through the API");
  // withdraw: the text leaves, the evidence stays, the row cannot be deleted
  const { data: w } = await C.eng.from("comments").insert({ record_id: P.id, body: "Wrong number posted here" }).select("*").single();
  assert.ifError((await C.eng.from("comments").update({ deleted_at: new Date().toISOString() }).eq("id", w.id)).error);
  const [wd] = await sql("select body, deleted_at from comments where id = $1", [w.id]); assert.equal(wd.body, ""); assert.ok(wd.deleted_at);
  assert.equal((await sql("select body from comment_revisions where comment_id = $1 and action = 'withdraw'", [w.id]))[0].body, "Wrong number posted here");
  assert.equal((await sql("select count(*)::int n from activity where record_id = $1 and action = 'message_withdrawn'", [P.id]))[0].n, 1);
  const del = await C.eng.from("comments").delete().eq("id", w.id).select("id"); assert.ok(del.error || !del.data?.length, "no hard delete");
  const again = await C.eng.from("comments").update({ body: "back" }).eq("id", w.id).select("id"); assert.ok(again.error || !again.data?.length, "a withdrawn message stays withdrawn");
  // marks: only the project manager or management; a Decision goes into the project's decision log, once
  const no = await C.emp.rpc("comment_flag", { p_comment: r1.id, p_flag: "decision" }); assert.match(String(no.error?.message), /project manager or management/);
  const yes = await C.pm.rpc("comment_flag", { p_comment: r1.id, p_flag: "decision" }); assert.ifError(yes.error);
  const yes2 = await C.mgmt.rpc("comment_flag", { p_comment: r1.id, p_flag: "decision" }); assert.equal(yes2.data.decision, yes.data.decision, "the same decision, not a second one");
  const [dec] = await sql("select section, data->>'project_ref' p, data->>'source_ref' s, status from records where id = $1", [yes.data.decision]);
  assert.deepEqual([dec.section, dec.p, dec.s, dec.status], ["company.decisions", P.id, P.id, "Approved"]);
  assert.ok((await notes(U.eng.id, P.id)).some((n: any) => n.kind === "decision") || (await notes(U.emp.id, P.id)).some((n: any) => n.kind === "decision"), "the team hears about the decision");
  assert.ifError((await C.pm.rpc("comment_flag", { p_comment: m1.id, p_flag: "important" })).error);
  assert.ifError((await C.pm.rpc("comment_pin", { p_comment: m1.id, p_on: true })).error);
  assert.match(String((await C.eng.rpc("comment_pin", { p_comment: m1.id, p_on: false })).error?.message), /project manager or management/);
  const acts = (await sql("select action from activity where record_id = $1 order by id", [P.id])).map((a: any) => a.action);
  for (const a of ["decision_created", "message_decision", "message_important", "message_pinned"]) assert.ok(acts.includes(a), a);
  // links to a task: only records the author may open
  const { data: t } = await C.pm.from("records").insert({ section: "company.tasks", title: `Order connectors ${run}`, status: "New", data: { assignee_id: U.pm.id, project_ref: P.id } }).select("id").single();
  const { data: secret } = await db.from("records").insert({ section: "finance.budget", title: `Payroll ${run}`, status: "Draft", controlled: true, data: {} }).select("id").single();
  const { data: lk } = await C.eng.from("comments").insert({ record_id: P.id, body: "See the task", refs: [t.id, secret.id] }).select("refs").single();
  assert.deepEqual(lk.refs, [t.id], "a link to a record the author cannot open is dropped");
  // read markers
  assert.ifError((await C.eng.from("record_reads").upsert({ user_id: U.eng.id, record_id: P.id, read_at: new Date().toISOString() })).error);
});

/* 2 ------------------------------------------------------------------------------------------------------------ */
test("2. restricted project: a non-US employee sees no message, count, suggestion, notification or history", async () => {
  const { data: R } = await C.mgmt.from("records").insert({ section: "company.projects", title: `ITAR radar ${run}`, status: "Active", controlled: true, data: { manager_id: U.pm.id, members_ids: [U.eng.id] } }).select("*").single();
  const { data: m } = await C.pm.from("comments").insert({ record_id: R.id, body: `Seeker geometry zzrestricted${run} ${M(U.nonus)} ${M(U.eng)}` }).select("*").single();
  assert.deepEqual(m.mentions, [U.eng.id], "a non-US person cannot be mentioned on a controlled record");
  const sel = await C.nonus.from("comments").select("id").eq("record_id", R.id); assert.equal(sel.data?.length, 0);
  const cnt = await C.nonus.from("comments").select("id", { count: "exact", head: true }).eq("record_id", R.id); assert.equal(cnt.count, 0, "not even the count");
  assert.equal((await C.nonus.rpc("search_messages", { p_q: `zzrestricted${run}` })).data?.length, 0);
  assert.equal((await C.nonus.rpc("mention_candidates", { p_record: R.id, p_q: "" })).data?.length, 0);
  assert.equal((await notes(U.nonus.id, R.id)).length, 0);
  assert.equal((await C.nonus.from("activity").select("id").eq("record_id", R.id)).data?.length, 0, "history follows the record");
  const ins = await C.nonus.from("comments").insert({ record_id: R.id, body: "hello?" }).select("id"); assert.ok(ins.error, "cannot post into it");
  assert.match(String((await C.nonus.rpc("comment_flag", { p_comment: m.id, p_flag: "important" })).error?.message), /project manager or management/);
  // the US engineer on the team sees it
  assert.equal((await C.eng.from("comments").select("id").eq("record_id", R.id)).data?.length, 1);
  assert.equal((await C.eng.rpc("search_messages", { p_q: `zzrestricted${run}` })).data?.length, 1);
  const cand = (await C.pm.rpc("mention_candidates", { p_record: R.id, p_q: run })).data.map((x: any) => x.id);
  assert.ok(cand.includes(U.eng.id) && !cand.includes(U.nonus.id) && !cand.includes(U.pat.id), "suggestions only offer people who may read it");
  // the history of a controlled record is no longer readable by section access alone (v19 leak closed)
  const { data: T } = await C.pm.from("records").insert({ section: "company.tasks", title: `Controlled task ${run}`, status: "New", controlled: true, data: { assignee_id: U.pm.id } }).select("id").single();
  assert.equal((await C.nonus.from("activity").select("id,detail").eq("record_id", T.id)).data?.length, 0);
});

/* 3 ------------------------------------------------------------------------------------------------------------ */
test("3. external partner: sees the shared project's open discussion, never internal notes or other people", async () => {
  const { data: n } = await C.pm.from("comments").insert({ record_id: P.id, internal: true, body: `Internal: margin zzinternal${run}. ${M(U.pat)}` }).select("*").single();
  assert.deepEqual(n.mentions, [], "a partner cannot be mentioned in an internal note");
  const seen = (await C.pat.from("comments").select("id,body,internal").eq("record_id", P.id)).data || [];
  assert.ok(seen.length > 0, "the partner sees the open discussion of the project shared with Acme");
  assert.ok(!seen.some((c: any) => c.internal || c.id === n.id), "…but no internal note");
  assert.equal((await C.pat.rpc("search_messages", { p_q: `zzinternal${run}` })).data?.length, 0, "and cannot find one");
  const { data: pm } = await C.pat.from("comments").insert({ record_id: P.id, internal: true, body: `Delivery slot confirmed ${M(U.pm)} ${M(U.fin)}` }).select("*").single();
  assert.equal(pm.internal, false, "a partner cannot write internal notes");
  assert.ok(pm.mentions.includes(U.pm.id));
  assert.ok((await notes(U.pm.id, P.id)).some((x: any) => x.key === `mention:${pm.id}:${U.pm.id}`));
  const cand = (await C.pat.rpc("mention_candidates", { p_record: P.id, p_q: run })).data.map((x: any) => x.id);
  assert.ok(cand.includes(U.pm.id), "the project manager is suggested");
  assert.ok(!cand.includes(U.fin.id) && !cand.includes(U.owner.id) && !cand.includes(U.ven.id), "people outside the project are not revealed to a partner");
  assert.equal((await C.pat.from("activity").select("id").eq("record_id", P.id)).data?.length, 0, "no internal history for externals");
  // a vendor of another company: nothing at all
  assert.equal((await C.ven.from("records").select("id").eq("id", P.id)).data?.length, 0);
  assert.equal((await C.ven.from("comments").select("id").eq("record_id", P.id)).data?.length, 0);
  assert.equal((await C.ven.rpc("mention_candidates", { p_record: P.id, p_q: "" })).data?.length, 0);
  assert.ok(!(await notes(U.pat.id)).some((x: any) => x.key.includes(n.id)), "nothing about the internal note reached the partner");
});

/* 4 ------------------------------------------------------------------------------------------------------------ */
test("4. document review: a note on V2 stays on V2 when V3 arrives; owner and approver are told about a new version", async () => {
  const { data: D } = await C.eng.from("records").insert({ section: "company.documents", title: `Wiring spec ${run}`, status: "In review", data: { doc_type: "Specification", owner_id: U.eng.id, project_ref: P.id } }).select("*").single();
  const put = (v: string) => sql("insert into storage.objects(bucket_id, name) values ('files', $1)", [`company.documents/${D.id}/${v}-spec.pdf`]);
  await put("v1"); await put("v2");
  const { data: c2 } = await C.pm.from("comments").insert({ record_id: D.id, kind: "review", file_path: `company.documents/${D.id}/v2-spec.pdf`, version_label: "V2", body: "Page 3: torque value missing" }).select("*").single();
  assert.deepEqual([c2.kind, c2.version_label], ["review", "V2"]);
  const { data: bad } = await C.pm.from("comments").insert({ record_id: D.id, file_path: `finance.expenses/x/secret.pdf`, version_label: "V9", body: "x" }).select("*").single();
  assert.equal(bad.file_path, null, "a version path must belong to this document");
  const { data: f } = await C.pm.from("comments").insert({ record_id: D.id, body: "with file", files: [{ path: `company.documents/${D.id}/v2-spec.pdf`, name: "v2" }, { path: `hr.people/${D.id}/x.pdf` }] }).select("files").single();
  assert.equal(f.files.length, 1, "attachments must belong to this record");
  await put("v3");
  const n = await C.pm.rpc("document_version_uploaded", { p_record: D.id, p_path: `company.documents/${D.id}/v3-spec.pdf`, p_label: "V3" }); assert.ifError(n.error);
  assert.ok((await notes(U.eng.id, D.id)).some((x: any) => x.kind === "doc_version"), "the owner hears about V3");
  assert.equal((await sql("select file_path from comments where id = $1", [c2.id]))[0].file_path, `company.documents/${D.id}/v2-spec.pdf`, "the V2 note stays on V2");
  const nope = await C.pm.rpc("document_version_uploaded", { p_record: D.id, p_path: `company.documents/${D.id}/missing.pdf` }); assert.ok(nope.error, "only a stored file counts as a version");
  assert.ok((await C.nonus.from("comments").select("id").eq("record_id", D.id)).data!.length >= 1, "an ordinary document is open to the team");
});

/* 5 ------------------------------------------------------------------------------------------------------------ */
test("5. announcement: only the audience sees it; acknowledgement per version; a changed text needs a new one", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const draft = { section: "company.announcements", title: `New torque procedure ${run}`, status: "Draft", data: { message: "Use 12 Nm on all M6 bolts.", priority: "Important", audience_type: "department", audience: `Eng ${run}`, publish_at: today, ack_required: true } };
  const emp = await C.eng.from("records").insert(draft).select("id"); assert.ok(emp.error, "only management publishes announcements");
  const { data: A, error } = await C.mgmt.from("records").insert(draft).select("*").single(); assert.ifError(error);
  assert.equal(A.data.ann_version, 1);
  assert.equal((await C.eng.from("records").select("id").eq("id", A.id)).data?.length, 0, "a draft is not visible to the audience");
  assert.ifError((await C.mgmt.from("records").update({ status: "Published" }).eq("id", A.id)).error);
  assert.equal((await C.eng.from("records").select("id").eq("id", A.id)).data?.length, 1, "engineering sees it");
  assert.equal((await C.nonus.from("records").select("id").eq("id", A.id)).data?.length, 1, "non-US engineering too (not controlled)");
  for (const k of ["emp", "fin", "pat", "ven"]) {
    assert.equal((await C[k].from("records").select("id").eq("id", A.id)).data?.length, 0, `${k} outside the audience: it does not exist`);
    assert.equal((await C[k].from("records").select("id", { count: "exact", head: true }).eq("section", "company.announcements").eq("title", draft.title)).count, 0);
  }
  assert.ok((await notes(U.eng.id, A.id)).some((n: any) => n.key === `ann:${A.id}:v1:${U.eng.id}`));
  assert.equal((await notes(U.emp.id, A.id)).length, 0);
  assert.ifError((await C.mgmt.from("records").update({ status: "Published", data: { ...A.data, publish_at: today } }).eq("id", A.id)).error);
  assert.equal((await notes(U.eng.id, A.id)).length, 1, "no second notification without a change of text");
  assert.equal((await C.eng.rpc("announcement_ack", { p_id: A.id })).data, 1);
  assert.equal((await C.emp.rpc("announcement_ack", { p_id: A.id })).error?.code, "42501", "outside the audience: not found");
  let st = (await C.mgmt.rpc("announcement_stats", { p_id: A.id })).data;
  assert.equal(st.audience, 3, "the Engineering department: project manager, engineer, non-US engineer");
  assert.equal(st.acknowledged, 1);
  assert.match(String((await C.eng.rpc("announcement_stats", { p_id: A.id })).error?.message), /Not allowed/, "employees do not see who has acknowledged");
  // a material change: version 2, everyone must acknowledge again
  const { data: A2 } = await C.mgmt.from("records").select("*").eq("id", A.id).single();
  assert.ifError((await C.mgmt.from("records").update({ data: { ...A2.data, message: "Use 14 Nm on all M6 bolts." } }).eq("id", A.id)).error);
  st = (await C.mgmt.rpc("announcement_stats", { p_id: A.id })).data;
  assert.deepEqual([st.version, st.acknowledged], [2, 0]);
  assert.ok(st.outstanding.some((p: any) => p.id === U.eng.id));
  assert.ok((await notes(U.eng.id, A.id)).some((n: any) => n.key === `ann:${A.id}:v2:${U.eng.id}`), "the audience is told about the new text");
  assert.equal((await C.eng.rpc("announcement_ack", { p_id: A.id })).data, 2);
  const acks = await sql("select version from announcement_acks where announcement_id = $1 and user_id = $2 order by version", [A.id, U.eng.id]);
  assert.deepEqual(acks.map((a: any) => a.version), [1, 2], "both acknowledgements stay as evidence");
  assert.ok((await sql("select count(*)::int n from activity where record_id = $1 and action = 'acknowledged'", [A.id]))[0].n >= 2);
  // critical announcement to the whole company: mandatory, cannot be muted
  await db.from("profiles").update({ notify_prefs: { muted: ["announcement", "announcement_critical"] } }).eq("id", U.fin.id);
  const { data: K } = await C.mgmt.from("records").insert({ section: "company.announcements", title: `Office closed ${run}`, status: "Published", data: { message: "Storm warning.", priority: "Critical", audience_type: "company", publish_at: today } }).select("id").single();
  const fk = await notes(U.fin.id, K.id); assert.equal(fk.length, 1); assert.equal(fk[0].critical, true);
  assert.equal((await notes(U.pat.id, K.id)).length, 0, "partners are not company audience");
  // scheduled for later: invisible and silent until its day
  const { data: L } = await C.mgmt.from("records").insert({ section: "company.announcements", title: `Next month ${run}`, status: "Published", data: { message: "Later.", audience_type: "roles", audience: "operations", publish_at: "2099-01-01" } }).select("id").single();
  assert.equal((await C.emp.from("records").select("id").eq("id", L.id)).data?.length, 0); assert.equal((await notes(U.emp.id, L.id)).length, 0);
  // expired: gone for the audience, kept for management
  const { data: X } = await C.mgmt.from("records").insert({ section: "company.announcements", title: `Old ${run}`, status: "Published", data: { message: "Old.", audience_type: "company", publish_at: "2020-01-01", expires: "2020-02-01" } }).select("id").single();
  assert.equal((await C.emp.from("records").select("id").eq("id", X.id)).data?.length, 0); assert.equal((await C.mgmt.from("records").select("id").eq("id", X.id)).data?.length, 1);
});

/* 6 ------------------------------------------------------------------------------------------------------------ */
test("6. meeting: an action item becomes one task, even when clicked twice at once", async () => {
  const { data: Mt } = await C.pm.from("records").insert({ section: "company.meetings", title: `Design review ${run}`, status: "Planned",
    data: { date: "2026-10-21", time: "10:00", timezone: "America/New_York", organizer_id: U.pm.id, project_ref: P.id, project_ref_title: P.title, participants_ids: [U.eng.id, U.emp.id],
      action_items: [{ id: "a1", title: `Update harness drawing ${run}`, description: "Rev C", assignee_id: U.eng.id, due: "2026-10-28" }, { id: "a2", title: "Book the test cell" }] } }).select("*").single();
  const [x, y] = await Promise.all([C.pm.rpc("meeting_action_to_task", { p_meeting: Mt.id, p_item: "a1" }), C.pm.rpc("meeting_action_to_task", { p_meeting: Mt.id, p_item: "a1" })]);
  assert.ifError(x.error); assert.ifError(y.error); assert.equal(x.data, y.data, "the same task");
  assert.equal((await sql("select count(*)::int n from records where section = 'company.tasks' and data->>'_idem' = $1", [`meeting:${Mt.id}:a1`]))[0].n, 1);
  const [t] = await sql("select title, data from records where id = $1", [x.data]);
  assert.deepEqual([t.data.assignee_id, t.data.due, t.data.project_ref, t.data.meeting_ref], [U.eng.id, "2026-10-28", P.id, Mt.id]);
  assert.equal((await sql("select data->'action_items'->0->>'task_id' t from records where id = $1", [Mt.id]))[0].t, x.data, "the meeting remembers the task");
  assert.ok((await notes(U.eng.id, x.data)).some((n: any) => n.kind === "assigned"), "the responsible person is told");
  assert.equal((await C.pm.rpc("meeting_action_to_task", { p_meeting: Mt.id, p_item: "a1" })).data, x.data, "a third click: still one task");
  assert.match(String((await C.emp.rpc("meeting_action_to_task", { p_meeting: Mt.id, p_item: "a2" })).error?.message), /meeting owner/, "a participant cannot create tasks from someone else's meeting");
  const d1 = await C.pm.rpc("record_decision", { p_source: Mt.id, p_text: "Go with harness rev C" }), d2 = await C.pm.rpc("record_decision", { p_source: Mt.id, p_text: "go with harness rev c " });
  assert.equal(d1.data, d2.data, "the same decision is recorded once");
  assert.ok((await sql("select count(*)::int n from activity where record_id = $1 and action = 'task_from_meeting'", [Mt.id]))[0].n === 1);
});

/* 7 ------------------------------------------------------------------------------------------------------------ */
test("7. delivery: two workers at once send each notification once; quiet hours hold e-mail, never the in-app list", async () => {
  clearMail();
  await db.from("profiles").update({ notify_prefs: { email: ["mention"] } }).eq("id", U.ops.id);
  for (let i = 0; i < 12; i++) await C.emp.from("comments").insert({ record_id: P.id, body: `Ping ${i} ${M(U.ops)}` });
  // ops is not on the team but reads projects: mention notifications are created
  const before = await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'mention' and email_state = 'pending'", [U.ops.id]);
  assert.equal(before[0].n, 12);
  // everyone else's pending mail is delivered too; what matters is that no row goes out twice
  const [r1, r2] = await Promise.all([deliverNotifications(db, { deadline: Date.now() + 25000, batch: 4 }), deliverNotifications(db, { deadline: Date.now() + 25000, batch: 4 })]);
  const got = mailsTo(U.ops.email);
  for (let i = 0; i < 12; i++) assert.equal(got.filter((m: any) => new RegExp(`Ping ${i}\\b`).test(String(m.raw))).length, 1, `ping ${i} in exactly one letter`);
  assert.ok(r1.claimed + r2.claimed >= 12);
  assert.equal((await sql("select count(*)::int n from notifications where user_id = $1 and kind = 'mention' and email_state = 'sent'", [U.ops.id]))[0].n, 12);
  // quiet hours covering the whole day: held, then sent when the window ends; the in-app row is there at once
  clearMail();
  await db.from("profiles").update({ notify_prefs: { email: ["mention"], quiet: { from: "00:00", to: "23:59" }, tz: "UTC" } }).eq("id", U.ops.id);
  await C.emp.from("comments").insert({ record_id: P.id, body: `Quiet ${M(U.ops)}` });
  const q = await deliverNotifications(db, { deadline: Date.now() + 8000, now: new Date("2026-10-20T12:00:00Z") });
  assert.ok(q.held >= 1); assert.equal(mailsTo(U.ops.email).length, 0, "nothing during quiet hours");
  const [held] = await sql("select email_state, read_at from notifications where user_id = $1 order by id desc limit 1", [U.ops.id]);
  assert.equal(held.email_state, "held"); assert.equal(held.read_at, null);
  await db.from("profiles").update({ notify_prefs: { email: ["mention"] } }).eq("id", U.ops.id);
  await sql("update notifications set claimed_at = now() - interval '6 minutes' where user_id = $1 and email_state = 'held'", [U.ops.id]);
  await deliverNotifications(db, { deadline: Date.now() + 8000 });
  assert.equal(mailsTo(U.ops.email).length, 1, "sent after quiet hours");
  // daily summary: one letter per day with everything; the second run the same day sends nothing
  clearMail();
  await db.from("profiles").update({ notify_prefs: { email: ["mention"], email_mode: "daily", tz: "UTC" } }).eq("id", U.ops.id);
  for (let i = 0; i < 3; i++) await C.emp.from("comments").insert({ record_id: P.id, body: `Digest ${i} ${M(U.ops)}` });
  await deliverNotifications(db, { deadline: Date.now() + 8000, now: new Date("2026-10-20T06:00:00Z") });
  assert.equal(mailsTo(U.ops.email).length, 0, "before 8:00 the summary waits");
  await sql("update notifications set claimed_at = now() - interval '6 minutes' where user_id = $1 and email_state = 'held'", [U.ops.id]);
  await deliverNotifications(db, { deadline: Date.now() + 8000, now: new Date("2026-10-20T08:30:00Z") });
  const dg = mailsTo(U.ops.email); assert.equal(dg.length, 1); assert.match(dg[0].subject || dg[0].raw, /daily summary/);
  await C.emp.from("comments").insert({ record_id: P.id, body: `Later ${M(U.ops)}` });
  await deliverNotifications(db, { deadline: Date.now() + 8000, now: new Date("2026-10-20T09:00:00Z") });
  assert.equal(mailsTo(U.ops.email).length, 1, "one summary a day");
  // e-mail off: in-app only
  await db.from("profiles").update({ notify_prefs: { email_mode: "off" } }).eq("id", U.ops.id);
  await C.emp.from("comments").insert({ record_id: P.id, body: `Off ${M(U.ops)}` });
  const [off] = await sql("select email_state from notifications where user_id = $1 order by id desc limit 1", [U.ops.id]); assert.equal(off.email_state, null);
  await db.from("profiles").update({ notify_prefs: {} }).eq("id", U.ops.id);
});

/* 8 ------------------------------------------------------------------------------------------------------------ */
test("8. e-mail outcome: sent, refused (failed) and unknown (uncertain — never sent again by itself); no controlled text in mail", async () => {
  clearMail();
  const mk = async (addr: string) => { const u = await makeUser(addr, "engineering", { us: true, name: `Mail ${addr}` }); return u; };
  const ok = await mk(`ok-${run}@agron-stack.test`), bad = await mk(`nobody-${run}@fail.test`), lost = await mk(`lost-${run}@drop.test`);
  const { data: R } = await C.pm.from("records").insert({ section: "company.projects", title: `Hidden name ${run}`, status: "Active", controlled: true, data: { manager_id: U.pm.id } }).select("id").single();
  for (const u of [ok, bad, lost]) await C.pm.from("comments").insert({ record_id: R.id, body: `Controlled detail zzsecret${run} @[x](${u.id})` });
  await deliverNotifications(db, { deadline: Date.now() + 15000 });
  const st = async (u: any) => (await sql("select email_state, attempts from notifications where user_id = $1", [u.id]))[0];
  assert.equal((await st(ok)).email_state, "sent"); assert.equal((await st(bad)).email_state, "failed"); assert.equal((await st(lost)).email_state, "uncertain");
  const m = mailsTo(ok.email); assert.equal(m.length, 1);
  assert.ok(!String(m[0].raw).includes(`zzsecret${run}`) && !String(m[0].raw).includes(`Hidden name ${run}`), "a controlled record's title and text stay out of e-mail");
  const n = mails().length; await sql("update notifications set claimed_at = null where user_id = $1", [lost.id]);
  await deliverNotifications(db, { deadline: Date.now() + 8000 });
  assert.equal(mails().length, n, "an uncertain delivery is not repeated");
  // operations view: administrators see the problem, not the message
  const ops = await C.admin.rpc("communication_issues", { p_days: 1 }); assert.ifError(ops.error);
  const rows = ops.data.notifications.filter((x: any) => [bad.id, lost.id].includes(x.user) || /Mail /.test(x.user));
  assert.ok(rows.length >= 2); assert.ok(!JSON.stringify(ops.data).includes(`zzsecret${run}`), "no message content in the operations view");
  assert.ok(ops.data.totals.uncertain_email >= 1);
  assert.match(String((await C.eng.rpc("communication_issues", { p_days: 1 })).error?.message), /Administrators only/);
});

/* 9 ------------------------------------------------------------------------------------------------------------ */
test("9. session revocation: a revoked session reads no message, suggestion, search or announcement", async () => {
  const s = await signIn(U.eng.email);
  assert.ok((await s.c.from("comments").select("id").eq("record_id", P.id)).data!.length > 0);
  await new Promise((r) => setTimeout(r, 1100));
  assert.ifError((await db.rpc("revoke_sessions", { p_user: U.eng.id })).error);
  assert.equal((await s.c.from("comments").select("id").eq("record_id", P.id)).data?.length || 0, 0);
  assert.equal((await s.c.rpc("mention_candidates", { p_record: P.id, p_q: "" })).data?.length || 0, 0);
  assert.equal((await s.c.rpc("search_messages", { p_q: "Supplier" })).data?.length || 0, 0);
  assert.ok((await s.c.from("comments").insert({ record_id: P.id, body: "after revoke" }).select("id")).error);
  assert.ok((await s.c.rpc("comment_flag", { p_comment: (await sql("select id from comments where record_id = $1 limit 1", [P.id]))[0].id, p_flag: "important" })).error);
  assert.equal((await s.c.from("notifications").select("id")).data?.length || 0, 0);
  await new Promise((r) => setTimeout(r, 1100));
  C.eng = (await signIn(U.eng.email)).c; // a new sign-in works again
  assert.ok((await C.eng.from("comments").select("id").eq("record_id", P.id)).data!.length > 0);
});

/* 10 ----------------------------------------------------------------------------------------------------------- */
test("10. search across discussions: filters, decisions, mentions; nothing leaks through excerpts or counts", async () => {
  const hit = (await C.pm.rpc("search_messages", { p_q: "connectors" })).data;
  assert.ok(hit.some((h: any) => h.record_id === P.id && h.section === "company.projects" && /connectors/.test(h.excerpt)));
  assert.ok(hit.every((h: any) => h.excerpt.length <= 220 && !/\]\([0-9a-f-]{36}\)/.test(h.excerpt)), "excerpts are short and show names, not ids");
  assert.equal((await C.pm.rpc("search_messages", { p_q: "connectors", p_decisions: true, p_project: P.id })).data.length, 1, "decisions filter");
  assert.ok((await C.eng.rpc("search_messages", { p_q: "supplier", p_mentions_me: true })).data.length >= 1, "mentions filter");
  assert.equal((await C.pm.rpc("search_messages", { p_q: "connectors", p_author: U.fin.id })).data.length, 0, "author filter");
  assert.ok((await C.pm.rpc("search_messages", { p_q: "connectors", p_project: P.id })).data.length >= 1, "project filter");
  assert.equal((await C.pm.rpc("search_messages", { p_q: "Wrong number" })).data.length, 0, "withdrawn text is not searchable");
  assert.equal((await C.pm.rpc("search_messages", { p_q: "x" })).data.length, 0, "at least two characters");
  assert.equal((await C.fin.rpc("search_messages", { p_q: `zzrestricted${run}` })).data.length, 1, "finance (US person) may read projects");
  assert.equal((await C.ven.rpc("search_messages", { p_q: "connectors" })).data.length, 0, "a vendor finds nothing in another company's project");
  assert.equal((await C.pat.rpc("search_messages", { p_q: `margin` })).data.length, 0, "a partner never finds internal notes");
  const anonR = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/search_messages`, { method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "content-type": "application/json" }, body: JSON.stringify({ p_q: "connectors" }) });
  assert.ok(anonR.status >= 400, "signed-out callers cannot search");
});
