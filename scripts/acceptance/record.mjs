// Records evidence files (written by the tools in .stack/evidence or .staging/evidence) into an environment's
// append-only evidence store (P9-R2). The target guard of the staging tools applies: --stack for the local isolated
// stack, otherwise TARGET_SUPABASE_URL / TARGET_ANON_KEY / TARGET_SERVICE_ROLE_KEY / TARGET_REF (never production).
//   node scripts/acceptance/record.mjs --stack .stack/evidence/reg-….json [more files]
// Each file holds one row or { "records": [rows] }. A row is recorded as written — its status, identity and metrics
// come from the execution that produced it; this tool adds nothing and cannot turn a FAIL into a PASS.
import fs from "node:fs";
import { target } from "../p9/target.mjs";

const T = target();
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!files.length) { console.error("usage: record.mjs [--stack] <evidence.json> …"); process.exit(2); }
let n = 0;
for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(f, "utf8"));
  for (const r of doc.records || [doc]) {
    const { data, error } = await T.admin.rpc("acceptance_record", { p: r });
    if (error) { console.error(`${f}: ${r.check_id} — ${error.message}`); process.exit(1); }
    console.log(`${r.check_id} ${r.status} (${r.source_ref}) → ${data}`); n++;
  }
}
console.log(`${n} evidence row(s) recorded on ${T.stack ? "the local stack" : T.ref}`);
