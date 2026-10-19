// Loads every source of the guide from the app's own code, so the guide always describes the current system.
const W = new URL("../../src/", import.meta.url).href;
export async function loadSources() {
  const { HANDBOOK } = await import(W + "config/handbook.ts");
  const L = await import(W + "config/learn.ts"); const I = await import(W + "config/learn-i18n.ts");
  const C = await import(W + "config/workspace.config.mjs"); const A = await import(W + "config/approvals.ts"); const IC = await import(W + "lib/icons.ts");
  return { hb: HANDBOOK, help: L.HELP, glossary: L.GLOSSARY, faq: L.SEED_FAQ, dict: { uk: I.UK, ar: I.AR },
    depts: C.DEPARTMENTS, secs: C.allSections(), roles: C.ROLES, approvals: A.APPROVALS, configs: C.PRODUCT_CONFIGS, icon: IC.svgIcon, colors: C.DEPT_COLORS };
}
export async function loadText(lang) { return (await import(W + `config/guide/${lang}.ts`)).default; }
export async function appVersion() { const fs = await import("node:fs"); const s = fs.readFileSync(new URL("../../src/components/App.tsx", import.meta.url), "utf8"); return s.match(/VERSION = "([^"]+)"/)[1]; }
