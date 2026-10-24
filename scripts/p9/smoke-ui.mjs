// Phase 9 browser smoke (B52 / B55): sign in and open the main screens; read-only, no business actions.
//   APP=http://127.0.0.1:3125 node scripts/p9/smoke-ui.mjs <email> [label]
// Password sign-in works only on the isolated stack (synthetic accounts). Prints one line per screen and exits 1 on a failure.
import { createRequire } from "node:module"; import { execSync } from "node:child_process"; import path from "node:path"; import fs from "node:fs";
const req = createRequire(import.meta.url);
let pw; try { pw = req("playwright"); } catch { pw = createRequire(path.join(execSync("npm root -g").toString().trim(), "x.js"))("playwright"); }
const APP = process.env.APP || "http://127.0.0.1:3125", email = process.argv[2], label = process.argv[3] || "app";
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find((p) => fs.existsSync(p));
const b = await pw.chromium.launch({ executablePath: exe, args: ["--no-proxy-server"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
let fail = 0; const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${label} ${name}${extra ? " — " + extra : ""}`); if (!cond) fail++; };
const t0 = Date.now();
await p.goto(`${APP}/login`, { waitUntil: "networkidle" });
const pass = p.locator("#password");
if (!(await pass.count())) { const b2 = p.getByText(/password|пароль/i).first(); if (await b2.count()) await b2.click(); }
await p.fill("#email", email); await p.fill("#password", "Stack-Test-Password-1!"); await p.click("button[type=submit]");
await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {});
ok("sign-in", !new URL(p.url()).pathname.startsWith("/login"), `${Date.now() - t0} ms`);
for (const [name, route] of [["home", "/"], ["search", "/search?q=Rehearsal"], ["legal", "/legal"], ["technical", "/technical"], ["admin", "/admin"]]) {
  const t = Date.now(); const r = await p.goto(`${APP}${route}`, { waitUntil: "networkidle" }).catch((e) => null);
  await p.waitForTimeout(800);
  const body = (await p.textContent("body").catch(() => "")) || "";
  const broken = /Application error|Something went wrong|Internal Server Error/i.test(body);
  ok(name, !!r && r.status() < 500 && !broken && !new URL(p.url()).pathname.startsWith("/login"), `${r?.status()} ${Date.now() - t} ms`);
}
ok("no script errors", errs.length === 0, errs.slice(0, 3).join(" | "));
await b.close(); process.exit(fail ? 1 : 0);
