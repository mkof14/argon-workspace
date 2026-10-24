// Shared guard for the Phase 9 staging tools: which Supabase project they act on, and the refusal to touch any other.
//   TARGET_SUPABASE_URL, TARGET_ANON_KEY, TARGET_SERVICE_ROLE_KEY — the STAGING project (entered by the owner in the
//   shell that runs the tool; never committed, never printed)
//   TARGET_REF — the staging project ref, typed again as a confirmation; must match the URL and the keys
//   PRODUCTION_REF (optional, recommended) — the production ref; the tools refuse it outright
//   --stack — run against the local isolated stack instead (reads .stack/env.json; for checking the tools themselves)
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ref = (u) => { try { const h = new URL(u).hostname; const m = h.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/); return m ? m[1] : (/^(127\.0\.0\.1|localhost)$/.test(h) ? "local" : null); } catch { return null; } };
const keyRef = (k) => { try { return JSON.parse(Buffer.from(String(k).split(".")[1], "base64url").toString()).ref || null; } catch { return null; } };

export function target() {
  const stack = process.argv.includes("--stack");
  let url, anonKey, service, want;
  if (stack) {
    const e = JSON.parse(fs.readFileSync(path.resolve(".stack/env.json"), "utf8"));
    url = e.NEXT_PUBLIC_SUPABASE_URL; anonKey = e.NEXT_PUBLIC_SUPABASE_ANON_KEY; service = e.SUPABASE_SERVICE_ROLE_KEY; want = "local";
  } else {
    const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
    url = need("TARGET_SUPABASE_URL"); anonKey = need("TARGET_ANON_KEY"); service = need("TARGET_SERVICE_ROLE_KEY"); want = need("TARGET_REF");
  }
  const r = ref(url);
  if (!r || r !== want) { console.error(`Refused: the URL is not the project you named (${want}).`); process.exit(3); }
  if (process.env.PRODUCTION_REF && r === process.env.PRODUCTION_REF) { console.error("Refused: this is the production project."); process.exit(3); }
  for (const [n, k] of [["anon", anonKey], ["service", service]]) { const kr = keyRef(k); if (kr && kr !== r) { console.error(`Refused: the ${n} key belongs to another project.`); process.exit(3); } }
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const dir = path.resolve(".staging"); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { ref: r, url, stack, admin: createClient(url, service, opts), anon: () => createClient(url, anonKey, opts), file: (n) => path.join(dir, `${n}-${r}.json`) };
}

/** Synthetic personas (P9-R1 R12): role, US-person status, external company, business capabilities, disabled. */
export const PERSONAS = [
  { key: "owner-us", role: "owner", us: true },
  { key: "mgmt-us", role: "management", us: true },
  { key: "mgmt-nonus", role: "management", us: false },
  { key: "eng-us", role: "engineering", us: true, caps: ["bom_editor"] },
  { key: "eng-nonus", role: "engineering", us: false },
  { key: "sales", role: "sales", us: true },
  { key: "operations", role: "operations", us: true },
  { key: "manufacturing", role: "operations", us: true, caps: ["build_manager", "work_order_manager", "inventory_manager", "quality_inspector"] },
  { key: "technician", role: "operations", us: true, caps: ["test_operator"] },
  { key: "sysadmin", role: "admin", us: true },
  { key: "partner", role: "partner", us: false, company: "P9 Synthetic Partner Co" },
  { key: "vendor", role: "vendor", us: false, company: "P9 Synthetic Vendor Co" },
  { key: "disabled", role: "sales", us: true, disabled: true },
];
