import { test } from "node:test";
import assert from "node:assert/strict";
import { envOf, dbAllowed, envBanner, blockedRecipients } from "../src/lib/env.ts";
import { APP_VERSION, DB_VERSION } from "../src/lib/version.ts";
import fs from "node:fs";

test("environment: production wins, staging needs the explicit flag, a plain preview has no database", () => {
  assert.equal(envOf("production", "staging"), "production");
  assert.equal(envOf("preview", "staging"), "staging");
  assert.equal(envOf("preview", ""), "preview");
  assert.equal(envOf("preview", "production"), "preview"); // a flag cannot make a preview production
  assert.equal(envOf("", ""), "development");
  assert.equal(envOf(undefined, "STAGING"), "staging");
  assert.equal(dbAllowed("preview"), false);
  for (const e of ["production", "staging", "development"] as const) assert.equal(dbAllowed(e), true);
  assert.equal(envBanner("production"), null);
  assert.equal(envBanner("development"), null);
  for (const e of ["staging", "preview"] as const) { const b = envBanner(e)!; for (const l of ["en", "ru", "uk", "ar"] as const) assert.ok(b[l].length > 10, `${e} ${l}`); }
});

test("staging e-mail goes only to allowed test domains", () => {
  assert.deepEqual(blockedRecipients("a@customer.com", "production", ""), []);
  assert.deepEqual(blockedRecipients("a@agron1.com", "staging", ""), ["a@agron1.com"]); // no list: nothing leaves
  assert.deepEqual(blockedRecipients(["a@agron1.com", "Bob <b@AGRON1.com>"], "staging", "agron1.com"), []);
  assert.deepEqual(blockedRecipients("a@agron1.com, c@customer.com", "staging", "agron1.com"), ["c@customer.com"]);
  assert.deepEqual(blockedRecipients("x@agron1.com.evil.io", "preview", "agron1.com"), ["x@agron1.com.evil.io"]);
  assert.deepEqual(blockedRecipients("not-an-address", "staging", "agron1.com"), ["not-an-address"]);
});

test("release identification: app version, expected database version and the v26 migration agree", () => {
  assert.match(APP_VERSION, /^\d+\.\d+$/);
  const ups = fs.readdirSync("supabase").filter((f) => /^update-v\d+\.sql$/.test(f)).map((f) => +f.match(/\d+/)![0]);
  assert.equal(DB_VERSION, Math.max(...ups));
  const v26 = fs.readFileSync("supabase/update-v26.sql", "utf8");
  assert.match(v26, new RegExp(`select ${DB_VERSION} \\$\\$`));
  assert.ok(fs.existsSync(`supabase/rollback-v${DB_VERSION}.sql`));
  const app = fs.readFileSync("src/components/App.tsx", "utf8");
  assert.match(app, /export const VERSION = APP_VERSION;/);
});

test("database connection settings are read only through the environment guard", () => {
  // every place that builds a Supabase client takes the URL and key from src/lib/env.ts
  for (const f of ["src/lib/sb.ts", "src/lib/server/supabase.ts", "src/middleware.ts"]) {
    const s = fs.readFileSync(f, "utf8");
    assert.ok(!/process\.env\.NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)/.test(s), f);
    assert.match(s, /SUPABASE_URL/);
  }
});
