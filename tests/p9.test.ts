import { test } from "node:test";
import assert from "node:assert/strict";
import { decideEnv, keyRef, urlRef, serverKeyAllowed, envBanner, envLabel, blockedRecipients } from "../src/lib/env.ts";
import { APP_VERSION, DB_VERSION } from "../src/lib/version.ts";
import fs from "node:fs";

// synthetic project refs and unsigned JWT-shaped keys (only the payload's "ref" matters; nothing here is a real key)
const P = "prodprodprodprodprod", S = "stagstagstagstagstag", O = "otherotherotherother";
const jwt = (ref: string) => `x.${Buffer.from(JSON.stringify({ iss: "supabase", ref, role: "anon" })).toString("base64url")}.y`;
const url = (ref: string) => `https://${ref}.supabase.co`;
const E = (o: any) => decideEnv(o);

test("environment routing (R2): production uses only its own project", () => {
  assert.deepEqual(E({ deploy: "production", url: url(P), anon: jwt(P) }), { env: "production", db: true, refused: null });
  assert.equal(E({ deploy: "production", url: url(P), anon: jwt(P), stagingRef: S }).db, true);
  assert.equal(E({ deploy: "production", url: url(S), anon: jwt(S), stagingRef: S }).db, false, "production pointed at staging is refused");
  assert.equal(E({ deploy: "production", url: url(P), anon: jwt(O) }).db, false, "mixed project key is refused");
  assert.equal(E({ deploy: "production", url: url(P), anon: jwt(P), flag: "staging" }).db, false, "ambiguous flag fails closed");
  assert.ok(E({ deploy: "production", url: url(P), anon: jwt(P), flag: "staging" }).refused);
  assert.equal(E({ deploy: "production", url: "http://127.0.0.1:54321", anon: "k" }).db, false, "production never uses a local database");
  assert.equal(E({ deploy: "production", url: url(P), anon: "sb_publishable_abc" }).db, true, "keys without a ref are accepted with a hosted URL");
});

test("environment routing (R2): preview has no database unless it opts in to staging exactly", () => {
  assert.deepEqual(E({ deploy: "preview", url: url(P), anon: jwt(P) }), { env: "preview", db: false, refused: null }, "the inherited production settings are ignored");
  assert.equal(E({ deploy: "preview", flag: "staging", url: url(S), anon: jwt(S), stagingRef: S }).db, true);
  assert.equal(E({ deploy: "preview", flag: "staging", url: url(S), anon: jwt(S), stagingRef: S }).env, "staging");
  const fallback = E({ deploy: "preview", flag: "staging", url: url(S), anon: jwt(P), stagingRef: S });
  assert.equal(fallback.db, false, "staging URL with the production key: never falls back to production credentials"); assert.ok(fallback.refused);
  assert.equal(E({ deploy: "preview", flag: "staging", url: url(P), anon: jwt(P), stagingRef: S }).db, false, "staging flag with the production URL is refused");
  assert.equal(E({ deploy: "preview", flag: "staging", url: url(S), anon: jwt(S) }).db, false, "the staging ref is required");
  assert.equal(E({ deploy: "preview", flag: "production", url: url(P), anon: jwt(P) }).db, false, "a flag cannot make a preview production");
  assert.equal(E({ deploy: "preview", flag: "production", url: url(P), anon: jwt(P) }).env, "preview");
});

test("environment routing (R2): local builds never reach production by accident", () => {
  assert.deepEqual(E({ url: "http://127.0.0.1:54321", anon: "k" }), { env: "development", db: true, refused: null });
  assert.equal(E({ url: url(P), anon: jwt(P) }).db, false, "a local build pointed at a hosted project is refused");
  assert.equal(E({ flag: "staging", url: url(S), anon: jwt(S), stagingRef: S }).db, true, "a local build may use staging with the explicit opt-in");
  assert.equal(E({ flag: "production", url: url(P), anon: jwt(P) }).db, false);
  assert.deepEqual(E({}), { env: "development", db: false, refused: null }, "no settings = demo");
  assert.equal(urlRef(url(P)), P); assert.equal(urlRef("http://localhost:3000"), "local"); assert.equal(urlRef("https://example.com"), null);
  assert.equal(keyRef(jwt(S)), S); assert.equal(keyRef("sb_publishable_x"), null);
  assert.equal(serverKeyAllowed(jwt(P), url(P)), true); assert.equal(serverKeyAllowed(jwt(P), url(S)), false, "production server key on staging is refused");
  assert.equal(serverKeyAllowed("", url(S)), false);
});

test("environment indicator (R3): banner on staging and preview, a footer label on development, nothing in production", () => {
  assert.equal(envBanner("production"), null); assert.equal(envBanner("development"), null); assert.equal(envLabel("production"), "");
  assert.equal(envLabel("development"), "DEVELOPMENT"); assert.equal(envLabel("staging"), "STAGING");
  for (const e of ["staging", "preview"] as const) { const b = envBanner(e)!; for (const l of ["en", "ru", "uk", "ar"] as const) assert.ok(b[l].length > 10, `${e} ${l}`); }
});

test("staging e-mail goes only to allowed test domains", () => {
  assert.deepEqual(blockedRecipients("a@customer.com", "production", ""), []);
  assert.deepEqual(blockedRecipients("a@agron1.com", "staging", ""), ["a@agron1.com"]); // no list: nothing leaves
  assert.deepEqual(blockedRecipients(["a@agron1.com", "Bob <b@AGRON1.com>"], "staging", "agron1.com"), []);
  assert.deepEqual(blockedRecipients("a@agron1.com, c@customer.com", "staging", "agron1.com"), ["c@customer.com"]);
  assert.deepEqual(blockedRecipients("x@agron1.com.evil.io", "preview", "agron1.com"), ["x@agron1.com.evil.io"]);
  assert.deepEqual(blockedRecipients("not-an-address", "staging", "agron1.com"), ["not-an-address"]);
  // an exact test mailbox (and its +tags) instead of a whole domain: staging never mails real colleagues
  assert.deepEqual(blockedRecipients(["qa@agron1.com", "qa+p9-sales@agron1.com"], "staging", "qa@agron1.com"), []);
  assert.deepEqual(blockedRecipients("ceo@agron1.com", "staging", "qa@agron1.com"), ["ceo@agron1.com"]);
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

test("registration safety (R4): only an uninvited pending account is refused", async () => {
  const { isUninvited } = await import("../src/lib/registration.ts");
  assert.equal(isUninvited({ invited_at: null }, { role: "pending" }), true, "self-registered: refused");
  assert.equal(isUninvited({ invited_at: "2026-10-01T00:00:00Z" }, { role: "pending" }), false, "invited, waiting for a role");
  assert.equal(isUninvited({ invited_at: null }, { role: "sales" }), false, "an account an administrator gave a role");
  assert.equal(isUninvited(null, { role: "pending" }), false);
  const login = fs.readFileSync("src/app/login/page.tsx", "utf8");
  assert.match(login, /shouldCreateUser: false/, "the e-mail link never creates an account");
  assert.ok(!/signUp\(/.test(login), "the sign-in page offers no sign-up");
  for (const f of ["src/app/auth/callback/route.ts", "src/app/auth/confirm/route.ts"]) assert.match(fs.readFileSync(f, "utf8"), /refuseUninvited/, f);
});
