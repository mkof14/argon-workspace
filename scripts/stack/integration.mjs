// Full integration run on the isolated stack: start the stack, build the app against it (into .next-stack, so the
// normal build is untouched), start it on 127.0.0.1:3125, run every suite in tests/integration, stop everything.
//
//   node scripts/stack/integration.mjs            all suites
//   node scripts/stack/integration.mjs rls e2e    only these (file name without .test.ts)
//   SKIP_BUILD=1 …                                reuse an existing .next-stack build
//
// Synthetic data only. Browser tests need Chromium (PW_CHROMIUM or Playwright's own); without the app they skip.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { up, down, ENV } from "./stack.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const PORT = 3125, APP = `http://127.0.0.1:${PORT}`;
const only = process.argv.slice(2);
const suites = fs.readdirSync(path.join(ROOT, "tests/integration")).filter((f) => f.endsWith(".test.ts")).filter((f) => !only.length || only.includes(f.replace(/\.test\.ts$/, ""))).map((f) => `tests/integration/${f}`);
const log = (...a) => console.error("[integration]", ...a);
const env = { ...process.env, ...ENV, NEXT_DIST_DIR: ".next-stack", NEXT_TELEMETRY_DISABLED: "1" };
let app;
const stop = () => { try { if (app?.pid) process.kill(-app.pid, "SIGTERM"); } catch {} down(); }; // the whole group: npx, next and its server
process.on("SIGINT", () => { stop(); process.exit(130); });

try {
  await up();
  const needApp = suites.some((s) => /\/(api|e2e)\.test\.ts$/.test(s));
  if (needApp) {
    if (!process.env.SKIP_BUILD) { log("build"); const b = spawnSync("npx", ["next", "build"], { cwd: ROOT, env, stdio: "inherit" }); if (b.status) throw new Error("build failed"); }
    try { await fetch(APP); throw new Error(`port ${PORT} is already in use — stop the old app first`); } catch (e) { if (/already in use/.test(e.message)) throw e; }
    const out = fs.openSync(path.join(ROOT, ".stack", "app.log"), "w");
    app = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", out, out], detached: true });
    const t = Date.now(); while (Date.now() - t < 60000) { try { if ((await fetch(`${APP}/api/health`)).status < 500) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
    log("app:", APP);
  }
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--import", "./scripts/guide/reg.mjs", "--test", "--test-concurrency=1", ...suites], { cwd: ROOT, env: { ...env, STACK_APP_URL: needApp ? APP : "" }, stdio: "inherit" });
  stop(); process.exit(r.status ?? 1);
} catch (e) { log("failed:", e.message); stop(); process.exit(1); }
