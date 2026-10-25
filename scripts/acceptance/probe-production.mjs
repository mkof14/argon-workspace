// Production touch probe (P9-R2 R2-20) — read-only, from public sources only; never writes to production.
//   node scripts/acceptance/probe-production.mjs [--db-markers='{"has_v18":false,…}' --db-source="…"] [--record --stack]
// Reads: the production health answer (public part), the production deployments that Vercel reports to GitHub, the
// main branch and the security hotfix branch. Production is "touched" in the cycle when a production deployment was
// created after the cycle start, or the deployed SHA is not the baseline. The database version comes from the
// read-only catalog markers given with --db-markers (and their source), because the production release (v2.33)
// does not report its database version.
import { execFileSync } from "node:child_process";
import { row, emit } from "./evidence.mjs";

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const REPO = process.env.REPO || "mkof14/argon-workspace", HEALTH = process.env.PROD_HEALTH || "https://workspace.agron1.com/api/health";
const CYCLE = process.env.CYCLE_START || "2026-10-19T00:54:00Z", BASELINE = process.env.BASELINE_SHA || "7234c5ed9a964b0d9229b472272e4edc28cb91ee";
const curl = (u) => { try { return execFileSync("curl", ["-sS", "--max-time", "20", "-w", "\n%{http_code}", u], { encoding: "utf8" }); } catch (e) { return `\n0`; } };
const at = new Date().toISOString();
const hr = curl(HEALTH); const code = Number(hr.trim().split("\n").pop()); let health = null; try { health = JSON.parse(hr.slice(0, hr.lastIndexOf("\n"))); } catch {}
const dr = curl(`https://api.github.com/repos/${REPO}/deployments?environment=Production&per_page=20`); let deps = []; try { deps = JSON.parse(dr.slice(0, dr.lastIndexOf("\n"))); } catch {}
const heads = Object.fromEntries(execFileSync("git", ["ls-remote", `https://github.com/${REPO}`, "refs/heads/main", "refs/heads/hotfix-v2.33-security"], { encoding: "utf8" }).trim().split("\n").map((l) => l.split("\t").reverse()));
const latest = Array.isArray(deps) ? deps[0] : null; const after = Array.isArray(deps) ? deps.filter((d) => d.created_at > CYCLE) : [];
const markers = arg("db-markers") ? JSON.parse(arg("db-markers")) : null;
const dbv = markers ? (markers.has_v28 ? 28 : markers.has_v27 ? 27 : markers.has_workspace_db_version ? "26 or later" : markers.has_v18_security_settings ? "18–25" : 17) : null;
const touched = !latest ? null : after.length > 0 || latest.sha !== BASELINE;
const hotfix = heads["refs/heads/hotfix-v2.33-security"];
const m = { touched, cycle_start: CYCLE, baseline_sha: BASELINE, deployment_id: latest?.id ?? null, deployment_created_at: latest?.created_at ?? null, sha: latest?.sha ?? null,
  deployments_after_cycle_start: after.map((d) => ({ id: d.id, sha: d.sha, created_at: d.created_at })), main_sha: heads["refs/heads/main"] || null,
  app_version: latest?.sha === BASELINE ? "2.33" : null, db_version: dbv, db_version_source: markers ? arg("db-source") || "read-only catalog markers" : "not probed", db_markers: markers,
  health: code ? { status: code, ok: health?.ok ?? null, reports_release: !!health?.release } : { status: null, note: "not reachable from the probe host" },
  limitations: "deployments are those Vercel reports to GitHub (Git integration); a deployment made outside it would not appear — the Vercel deployment list is the cross-check",
  security_patch: hotfix ? (latest?.sha === hotfix ? `hotfix deployed (${hotfix.slice(0, 7)})` : `hotfix candidate ${hotfix.slice(0, 7)} prepared — NOT deployed; production still on the vulnerable dependency baseline`) : "no hotfix branch" };
const r = await row("P9.PROD.TOUCH", "production", { status: latest ? "PASS" : "NOT VERIFIED", source: "scripts/acceptance/probe-production.mjs", source_ref: `production probe ${at}`, started_at: at,
  summary: touched === false ? `production unchanged: deployment ${latest.id} (${latest.sha.slice(0, 7)}) from ${latest.created_at}, before the cycle start` : touched ? `production changed in the cycle (${after.length} deployment(s))` : "probe incomplete",
  metrics: m });
console.log(JSON.stringify(m, null, 1));
let db = null;
if (process.argv.includes("--record")) { const { target } = await import("../p9/target.mjs"); db = target().admin; }
console.log(`evidence: ${await emit(r, { dir: ".stack/evidence", db })}`);
