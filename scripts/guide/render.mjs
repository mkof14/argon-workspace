// Renders out/guide_<lang>.html to PDF, reads the page of every chapter, rebuilds with page numbers in the contents.
// node --experimental-strip-types --import ./reg.mjs render.mjs <lang>   (needs pdftotext from poppler-utils)
import { chromium } from "./pw.mjs"; import fs from "node:fs"; import { execFileSync } from "node:child_process";
const lang = process.argv[2] || "en"; const here = new URL(".", import.meta.url).pathname;
const pdfPath = `${here}out/guide_${lang}.pdf`;
const build = () => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", `${here}reg.mjs`, `${here}build.mjs`, lang], { cwd: here, stdio: "ignore" });
const render = async () => { const b = await chromium.launch(); const p = await b.newPage(); await p.goto(`file://${here}out/guide_${lang}.html`, { waitUntil: "networkidle" }); await p.evaluate(() => document.fonts.ready); await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true }); await b.close(); };
const detect = () => { const txt = execFileSync("pdftotext", [pdfPath, "-"]).toString().split("\f"); const out = {}; txt.forEach((pg, i) => { for (const m of pg.matchAll(/QZ([a-z0-9]+)QZ/g)) if (!(m[1] in out)) out[m[1]] = i + 1; }); return { out, pages: txt.length - 1 }; };
let prev = ""; let info;
for (let i = 0; i < 4; i++) { build(); await render(); info = detect(); const s = JSON.stringify(info.out); fs.writeFileSync(`${here}out/pages_${lang}.json`, s); if (s === prev) break; prev = s; }
const toc = JSON.parse(fs.readFileSync(`${here}out/toc_${lang}.json`, "utf8")); const missing = toc.filter((t) => !info.out[t.id]).map((t) => t.id);
console.log(lang, "pages", info.pages, "missing", missing.join(",") || "none");
