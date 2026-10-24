// Produces the acceptance package from a running Workspace (P9-R2 R2-23/R2-32): records the findings register and
// the evidence files given, then calls System → Acceptance Evidence → Export as an owner and saves
// agron-acceptance.json and agron-acceptance.md. On the local isolated stack (--stack) it uses a synthetic owner
// account of the stack; against staging it needs an owner session cookie (OWNER_COOKIE) — never a password.
//   node scripts/acceptance/package.mjs --stack --app=http://127.0.0.1:3125 --out=.stack/acceptance [evidence files…]
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { target } from "../p9/target.mjs";

const T = target();
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const APP = arg("app", process.env.APP_URL), OUT = path.resolve(arg("out", ".stack/acceptance"));
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// 1. findings register (append-only versions; recorded only when the latest version differs)
const F = JSON.parse(fs.readFileSync(new URL("./findings.json", import.meta.url), "utf8"));
const { data: cur } = await T.admin.from("acceptance_findings").select("finding_id,state,severity,blocking_gate,seq").order("seq");
const latest = new Map((cur || []).map((r) => [r.finding_id, r]));
for (const f of F.findings) { const l = latest.get(f.finding_id); if (l && l.state === f.state && l.severity === f.severity && l.blocking_gate === f.blocking_gate) continue;
  const { error } = await T.admin.from("acceptance_findings").insert({ ...f, source: F.source }); if (error) throw new Error(`finding ${f.finding_id}: ${error.message}`); }
// 2. evidence files
for (const f of files) { const doc = JSON.parse(fs.readFileSync(f, "utf8")); for (const r of doc.records || [doc]) { const { error } = await T.admin.rpc("acceptance_record", { p: r }); if (error) throw new Error(`${f}: ${error.message}`); console.log(`recorded ${r.check_id} ${r.status} ${r.source_ref}`); } }
// 3. export as an owner
let cookie = process.env.OWNER_COOKIE || "";
if (!cookie && T.stack) {
  const email = "acceptance-owner@agron-stack.test", password = `Stack-${Math.random().toString(36).slice(2)}-A1!`;
  const { data: list } = await T.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let u = list?.users?.find((x) => x.email === email);
  if (!u) u = (await T.admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user; else await T.admin.auth.admin.updateUserById(u.id, { password });
  await T.admin.from("profiles").update({ role: "owner", us_person: true, full_name: "Stack acceptance owner (synthetic)" }).eq("id", u.id);
  const jar = new Map();
  const c = createServerClient(T.url, JSON.parse(fs.readFileSync(".stack/env.json", "utf8")).NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => jar.set(name, value)) } });
  const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error;
  cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
if (!APP || !cookie) { console.error("Need --app and an owner session (OWNER_COOKIE, or --stack)"); process.exit(2); }
const r = await fetch(`${APP}/api/acceptance`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ op: "export" }) });
const j = await r.json(); if (!r.ok) { console.error(`export failed: ${r.status} ${j.error}`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "agron-acceptance.json"), JSON.stringify(j.json, null, 1)); fs.writeFileSync(path.join(OUT, "agron-acceptance.md"), j.md);
console.log(`package: ${OUT}/agron-acceptance.md, agron-acceptance.json — staging ${j.json.readiness.staging_ready ? "READY" : "NOT READY"}, production ${j.json.readiness.production_ready ? "READY" : "NOT READY"}, live ${j.json.readiness.production_live ? "YES" : "NO"}`);
