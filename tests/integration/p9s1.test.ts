// P9-S1 — the hosted security suite (scripts/p9/s1-*.sql) on the isolated stack, exactly as it runs on staging:
// 13 synthetic personas × 29 read models, snapshots A/B (noise) → US-persons-only and restricted fixtures → snapshot C
// (aggregate leakage, search, documents, storage, comments, 1inow engines) → direct access by known id. Each persona is
// switched the way the API does it (JWT claims incl. claim.sub + role authenticated; the switch is asserted).
// Synthetic data only. Evidence: .stack/p9s1.json
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ENV, uid } from "./_stack.ts";

const DIR = path.join(process.cwd(), "scripts/p9");
const RUN = `S1L-${uid()}`;
// asynchronous, so the test's own timeout applies (the suite reads every model 3 × 13 times on the full regression data)
const psql = (args: string[]) => new Promise<string>((ok, bad) => {
  const c = spawn("psql", [ENV.STACK_PG_URL, "-v", "ON_ERROR_STOP=1", "-qtA", ...args], { cwd: DIR });
  let out = "", err = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d));
  c.on("close", (code) => (code === 0 ? ok(out.trim()) : bad(new Error(`psql ${args.join(" ")} failed: ${err.slice(0, 400)}`))));
});
// read models whose answer depends on the clock window (the last 7 days, the next 60 days, the calendar range): two
// reads minutes apart may differ when an existing record crosses the window edge. Their pairs are left out of the
// B→C aggregate comparison, but the content markers (LEAKUS / LEAKR) are still checked for them.
const WINDOWED = new Set(["changes_week", "deadlines", "calendar"]);

test("P9-S1 hosted security suite: no leak, no noise, every known-id check as expected", { timeout: 3_600_000 }, async () => {
  await psql(["-f", "s1-hosted-security.sql"]);
  await psql(["-f", "s1-personas.sql"]);
  const out = await psql(["-c", `set p9s1.run = '${RUN}'`, "-f", "s1-run.sql"]);
  const v = JSON.parse(out.split("\n").filter((l) => l.startsWith("{")).pop() || "{}");
  fs.mkdirSync(".stack", { recursive: true }); fs.writeFileSync(".stack/p9s1.json", JSON.stringify({ run: RUN, verdict: v }, null, 2));
  assert.equal(v.personas, 13, "13 synthetic personas");
  assert.equal(v.models_per_persona, 29, "29 read models per persona");
  const unexplained = v.noise_A_vs_B.filter((x: string) => !WINDOWED.has(x.split("/")[1]));
  assert.deepEqual(unexplained, [], "two reads without a change are identical (except clock-window models)");
  assert.deepEqual(v.us_only_leaks, [], "US-persons-only content reaches no non-US / external / disabled persona");
  assert.deepEqual(v.restricted_leaks, [], "restricted content reaches no persona outside its access list");
  assert.deepEqual(v.changed_for_unauthorised_B_to_C, [], "no aggregate, count or list changes for an unauthorised persona");
  assert.deepEqual([...v.positive_control_us_visible].sort(), ["eng-us", "mgmt-us", "owner-us"], "positive control: authorised US persons do see it");
  assert.ok(v.changed_for_authorised_B_to_C > 0, "the fixtures are visible where they should be");
  assert.equal(v.direct.fail, 0, `known-id access: ${JSON.stringify(v.direct.failures)}`);
  assert.equal(v.direct.checks, 91, "7 fixtures × 13 personas");
  // every error is an explicit refusal (42501), never a crash
  for (const [k, e] of Object.entries(v.errors || {})) assert.match(String(e), /^42501 /, `${k}: ${e}`);
  for (const k of ["partner", "vendor", "disabled"]) assert.ok(Object.keys(v.errors).some((x) => x.startsWith(`${k}/`)), `${k} is refused by the protected read models`);
});
