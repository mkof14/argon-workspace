// Builds the guide PDFs for all languages into /guide and writes guide/manifest.json.
// Run after every user-visible change (tests check that the guide matches the app version).
//   1) demo build running on :3124 (see shots.mjs)   2) node scripts/guide/make.mjs [langs…] [--no-shots]
import fs from "node:fs"; import { execFileSync } from "node:child_process";
const here = new URL(".", import.meta.url).pathname; const root = new URL("../../", import.meta.url).pathname;
const args = process.argv.slice(2); const langs = args.filter((a) => !a.startsWith("--")); const L = langs.length ? langs : ["en", "ru", "uk", "ar"];
const run = (f, a) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", `${here}reg.mjs`, `${here}${f}`, ...a], { cwd: here, stdio: "inherit" });
const ver = fs.readFileSync(`${root}src/components/App.tsx`, "utf8").match(/VERSION = "([^"]+)"/)[1];
const manPath = `${root}guide/manifest.json`; const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, "utf8")) : { langs: {} };
for (const l of L) {
  if (!args.includes("--no-shots")) run("shots.mjs", [l]);
  run("render.mjs", [l]);
  fs.copyFileSync(`${here}out/guide_${l}.pdf`, `${root}guide/AGRON-Workspace-Guide-${l}.pdf`);
  const pages = Number(execFileSync("pdfinfo", [`${root}guide/AGRON-Workspace-Guide-${l}.pdf`]).toString().match(/Pages:\s+(\d+)/)[1]);
  man.langs[l] = { pages, size: fs.statSync(`${root}guide/AGRON-Workspace-Guide-${l}.pdf`).size, version: ver };
}
man.version = ver; man.built = new Date().toISOString().slice(0, 10);
fs.writeFileSync(manPath, JSON.stringify(man, null, 1) + "\n"); console.log("guide", ver, Object.keys(man.langs).join(","));
