// P9-R1 R12 — creates the 13 SYNTHETIC staging personas. Run by the owner, on staging only, after deciding the mailbox:
//   TARGET_SUPABASE_URL=… TARGET_ANON_KEY=… TARGET_SERVICE_ROLE_KEY=… TARGET_REF=<staging ref> PRODUCTION_REF=<prod ref> \
//   PERSONA_EMAIL_BASE=qa@agron1.com node scripts/p9/staging-personas.mjs --yes
// Each persona gets qa+p9-<persona>@… (plus addressing to ONE test mailbox the owner controls; no real employee is
// invited), a random password, its role, US-person status, external company, capabilities and disabled flag. No
// e-mail is sent (accounts are confirmed directly). Passwords go only to .staging/personas-<ref>.json (git-ignored,
// readable only by the owner of the file), which the security, performance and endurance tools read.
//   --stack   check the tool on the local isolated stack (synthetic addresses @agron-stack.test)
import fs from "node:fs";
import crypto from "node:crypto";
import { row, emit } from "../acceptance/evidence.mjs";
import { target, PERSONAS } from "./target.mjs";

const T = target();
if (!T.stack && !process.argv.includes("--yes")) { console.error("Add --yes to create the staging personas."); process.exit(2); }
const base = T.stack ? "p9persona@agron-stack.test" : process.env.PERSONA_EMAIL_BASE;
if (!base || !/^[^@\s+]+@[^@\s]+\.[a-z]{2,}$/i.test(base)) { console.error("PERSONA_EMAIL_BASE must be one test mailbox, e.g. qa@agron1.com"); process.exit(2); }
const [local, domain] = base.split("@");
const out = { ref: T.ref, created: new Date().toISOString(), personas: {} };
const prev = fs.existsSync(T.file("personas")) ? JSON.parse(fs.readFileSync(T.file("personas"), "utf8")) : null;
for (const p of PERSONAS) {
  const email = `${local}+p9-${p.key}@${domain}`.toLowerCase();
  const password = `P9-${crypto.randomBytes(18).toString("base64url")}`;
  let id = prev?.personas?.[p.key]?.id;
  const { data: list } = await T.admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = (list?.users || []).find((u) => (u.email || "").toLowerCase() === email);
  if (found) { id = found.id; const { error } = await T.admin.auth.admin.updateUserById(id, { password, email_confirm: true }); if (error) throw new Error(`${p.key}: ${error.message}`); }
  else { const { data, error } = await T.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `P9 Synthetic ${p.key}` } }); if (error) throw new Error(`${p.key}: ${error.message}`); id = data.user.id; }
  const { error: e2 } = await T.admin.from("profiles").update({ role: p.role, us_person: !!p.us, company: p.company || null, full_name: `P9 Synthetic ${p.key}`, disabled: !!p.disabled }).eq("id", id);
  if (e2) throw new Error(`${p.key} profile: ${e2.message}`);
  for (const cap of p.caps || []) { const { error } = await T.admin.from("crm_caps").upsert({ user_id: id, cap, granted_by: id, revoked_at: null, revoked_by: null }, { onConflict: "user_id,cap" }); if (error) throw new Error(`${p.key} ${cap}: ${error.message}`); }
  out.personas[p.key] = { id, email, password, role: p.role, us: !!p.us, company: p.company || null, caps: p.caps || [], disabled: !!p.disabled };
  console.log(`persona ${p.key.padEnd(14)} ${p.role.padEnd(12)} us=${p.us ? "yes" : "no "} ${p.disabled ? "disabled " : ""}${(p.caps || []).join(",")}`);
}
fs.writeFileSync(T.file("personas"), JSON.stringify(out, null, 1), { mode: 0o600 });
console.log(`${PERSONAS.length} personas ready; credentials in .staging/personas-${T.ref}.json (not committed)`);
// acceptance evidence (P9-R2): how many synthetic personas exist (no names, no passwords)
const ev = await row("P9.PERSONAS.STAGING", T.stack ? "local" : "staging", { status: "PASS", source: "scripts/p9/staging-personas.mjs", source_ref: `personas ${new Date().toISOString()}`,
  summary: `${PERSONAS.length} synthetic personas`, metrics: { count: PERSONAS.length, roles: [...new Set(PERSONAS.map((p) => p.role))], synthetic: true } }, T.admin);
console.log(`evidence: ${await emit(ev, { db: T.admin })}`);
