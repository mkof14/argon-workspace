// node --experimental-strip-types --import ./reg.mjs build.mjs <lang>  →  out/guide_<lang>.html
import fs from "node:fs";
import { marked } from "marked";
import { guideBlocks } from "../../src/lib/guidemodel.ts";
import { loadSources, loadText, appVersion } from "./sources.mjs";

const lang = process.argv[2] || "en"; const here = new URL(".", import.meta.url).pathname;
const src = await loadSources(); const T = await loadText(lang); const S = T.S; const VERSION = await appVersion();
const pagesFile = `${here}out/pages_${lang}.json`; const pages = fs.existsSync(pagesFile) ? JSON.parse(fs.readFileSync(pagesFile, "utf8")) : {};
const NM = "file://" + new URL("../../node_modules/@fontsource", import.meta.url).pathname; const PUB = "file://" + new URL("../../public", import.meta.url).pathname;
const ASSETS = `file://${here}assets`; const IMG = `${here}img/${lang}`; const img = (n) => fs.existsSync(`${IMG}/${n}.jpg`) ? `file://${IMG}/${n}.jpg` : null;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s) => marked.parse(String(s || ""), { gfm: true });
const blocks = guideBlocks(lang, src, T, md, img);
const mk = (id) => `<span class="mk">QZ${id}QZ</span>`;
let body = ""; const toc = [];
for (const b of blocks) {
  if (b.kind === "part") { toc.push({ lvl: 1, id: b.id, t: `${S.part} ${b.num}. ${b.title}` });
    body += `<section class="divider">${mk(b.id)}<div class="dv-in"><div class="dv-n">${S.part} ${b.num}</div><h1>${esc(b.title)}</h1><p>${esc(b.lead)}</p><ol class="dv-list">${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div></section>`; }
  else if (b.id === "app") { toc.push({ lvl: 1, id: "app", t: S.appendix });
    body += `<section class="chapter">${mk("app")}<div class="ch-n">${S.appendix}</div><h2>${esc(b.title)}</h2>${b.html}<div class="end"><img src="${ASSETS}/agron.png"><p>AGRON Inc. · AGRON Workspace ${VERSION} · ${S.month}<br>${esc(S.end_note)}</p></div></section>`; }
  else { toc.push({ lvl: 2, id: b.id, t: `${b.num}. ${b.title}` });
    body += `<section class="chapter">${mk(b.id)}<div class="ch-n">${S.chapter} ${b.num}</div><h2>${esc(b.title)}</h2>${b.html}</section>`; }
}
const tocHtml = `<section class="toc"><h2>${S.contents}</h2><div class="toc-list">${toc.map((x) => `<div class="t${x.lvl}"><span>${esc(x.t)}</span><i></i><b>${pages[x.id] || ""}</b></div>`).join("")}</div></section>`;
const cover = `<section class="cover"><div class="cv-top"><img class="cv-logo" src="${ASSETS}/agron-tagline.png"></div>
  <div class="cv-mid"><div class="cv-k">${esc(S.cover_k)}</div><h1 dir="ltr">AGRON<br><span>Workspace</span></h1><p>${esc(S.cover_p)}</p></div>
  <div class="cv-bot"><img class="cv-sd" src="${ASSETS}/stardome.png"><div><b>${S.version} ${VERSION}</b><br>${S.month} · workspace.agron1.com<br>${esc(S.internal_doc)}</div></div></section>`;
const css = fs.readFileSync(`${here}guide.css`, "utf8").replace("AGRON Workspace · Руководство пользователя", S.footer);
const fonts = ["ibm-plex-sans/400.css", "ibm-plex-sans/400-italic.css", "ibm-plex-sans/500.css", "ibm-plex-sans/600.css", "ibm-plex-sans/700.css", "unbounded/600.css", "unbounded/700.css", "ibm-plex-sans-arabic/400.css", "ibm-plex-sans-arabic/600.css", "ibm-plex-sans-arabic/700.css"].map((f) => `<link rel="stylesheet" href="${NM}/${f}">`).join("");
fs.mkdirSync(`${here}out`, { recursive: true });
fs.writeFileSync(`${here}out/guide_${lang}.html`, `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>AGRON Workspace — ${esc(S.doc_title)}</title>${fonts}<style>${css}</style></head><body>${cover}${tocHtml}${body}</body></html>`);
fs.writeFileSync(`${here}out/toc_${lang}.json`, JSON.stringify(toc));
console.log(lang, "blocks", blocks.length);
