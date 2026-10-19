// Isolated test stack for AGRON Workspace: local Postgres + Supabase Auth + PostgREST + a gateway (Storage API,
// S3-compatible off-site bucket, SMTP sink) on one URL, like a Supabase project. Synthetic data only — it never
// connects to production. Binaries are pinned (version + SHA-256) and cached in .stack/ (git-ignored).
//
//   node scripts/stack/stack.mjs run <command…>   start, run the command with the stack env, stop
//   node scripts/stack/stack.mjs up               start and keep running (Ctrl+C stops)
//   node scripts/stack/stack.mjs env              print the env (JSON) of a running stack
//
// Needs Postgres 15+ server binaries (initdb, pg_ctl; preinstalled on GitHub's ubuntu runners) and network access to
// github.com for the first download.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const ROOT = new URL("../../", import.meta.url).pathname;
const STACK = process.env.STACK_DIR || path.join(ROOT, ".stack");
const ROOTUSER = process.getuid?.() === 0;
const PGDATA = process.env.STACK_PG_DATA || (ROOTUSER ? path.join(os.tmpdir(), "agron-stack-pg") : path.join(STACK, "pg"));
const P = { pg: 54329, auth: 54331, rest: 54330, gw: 54321, smtp: 54325 };
const SECRET = "agron-stack-jwt-secret-for-local-tests-only-0123456789";
const S3 = { id: "AKIASTACKTEST", secret: "stack-s3-secret-for-local-tests-only", bucket: "agron-backups", region: "us-east-1" };
const BIN = {
  postgrest: { url: "https://github.com/PostgREST/postgrest/releases/download/v12.2.8/postgrest-v12.2.8-linux-static-x86-64.tar.xz", sha256: "7da60261909ab7e6fc2f0c0c1d484985f17710151e1c94e8229559eaa23cd611", file: "postgrest" },
  auth: { url: "https://github.com/supabase/auth/releases/download/v2.177.0/auth-v2.177.0-x86.tar.gz", sha256: "fa48b1c1df11576c87b23e7f189ac6f01cd95265244eed7ff8a4e647858a0428", file: "auth" },
};
fs.mkdirSync(STACK, { recursive: true });
const log = (...a) => console.error("[stack]", ...a);

/* ---------------- helpers ---------------- */
const b64u = (b) => Buffer.from(b).toString("base64url");
export const jwt = (claims, secret = SECRET) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`; };
const far = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
const ANON = jwt({ iss: "supabase", role: "anon", iat: Math.floor(Date.now() / 1000), exp: far });
const SERVICE = jwt({ iss: "supabase", role: "service_role", iat: Math.floor(Date.now() / 1000), exp: far });
const PG_URL = `postgres://postgres@127.0.0.1:${P.pg}/postgres`;
export const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${P.gw}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  STACK_DIR: STACK, STACK_PG_URL: PG_URL, STACK_JWT_SECRET: SECRET, STACK_MAIL_DIR: path.join(STACK, "mail"),
  SMTP_HOST: "127.0.0.1", SMTP_PORT: String(P.smtp), SMTP_USER: "info@agron1.com", SMTP_PASS: "stack", IMAP_HOST: "127.0.0.1",
  BACKUP_PASSPHRASE: "stack backup passphrase — synthetic data only", BACKUP_S3_ENDPOINT: `http://127.0.0.1:${P.gw}/s3`, BACKUP_S3_BUCKET: S3.bucket,
  BACKUP_S3_REGION: S3.region, BACKUP_S3_KEY_ID: S3.id, BACKUP_S3_SECRET: S3.secret, CRON_SECRET: "stack-cron-secret", NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3125",
};
const pgBin = () => { for (const d of [process.env.PG_BIN, (() => { try { return execFileSync("pg_config", ["--bindir"]).toString().trim(); } catch { return ""; } })(), ...["17", "16", "15"].map((v) => `/usr/lib/postgresql/${v}/bin`)]) if (d && fs.existsSync(path.join(d, "initdb"))) return d; throw new Error("Postgres server binaries (initdb) not found — install postgresql or set PG_BIN"); };
const asPg = (cmd, args, opts = {}) => (ROOTUSER ? execFileSync("runuser", ["-u", "postgres", "--", cmd, ...args], opts) : execFileSync(cmd, args, opts));
const psql = (file, db = "postgres", user = "postgres") => execFileSync("psql", ["-h", "127.0.0.1", "-p", String(P.pg), "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, PGPASSWORD: "stack" } });
export const sql = (q, db = "postgres") => execFileSync("psql", ["-h", "127.0.0.1", "-p", String(P.pg), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-tA", "-c", q]).toString();
const wait = async (url, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error(`timeout waiting for ${url}`); };

async function binaries() {
  const dir = path.join(STACK, "bin"); fs.mkdirSync(dir, { recursive: true });
  for (const [name, b] of Object.entries(BIN)) {
    if (fs.existsSync(path.join(dir, name, b.file))) continue;
    log("download", name);
    const buf = Buffer.from(await (await fetch(b.url)).arrayBuffer());
    const h = crypto.createHash("sha256").update(buf).digest("hex"); if (h !== b.sha256) throw new Error(`${name}: checksum mismatch (${h})`);
    const tmp = path.join(dir, `${name}.archive`); fs.writeFileSync(tmp, buf); fs.mkdirSync(path.join(dir, name), { recursive: true });
    execFileSync("tar", [b.url.endsWith(".xz") ? "-xJf" : "-xzf", tmp, "-C", path.join(dir, name)]); fs.rmSync(tmp);
  }
  if (!fs.existsSync(path.join(STACK, "nm", "node_modules", "pg"))) { fs.mkdirSync(path.join(STACK, "nm"), { recursive: true }); fs.writeFileSync(path.join(STACK, "nm", "package.json"), '{"private":true}'); execFileSync("npm", ["i", "pg@8.13.1", "--no-audit", "--no-fund", "--silent"], { cwd: path.join(STACK, "nm"), stdio: "inherit" }); }
}

const procs = [];
function start(name, cmd, args, env) {
  const out = fs.openSync(path.join(STACK, `${name}.log`), "w");
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", out, out] }); procs.push(p);
  p.on("exit", (c) => c && log(`${name} exited ${c} — see .stack/${name}.log`)); return p;
}

export async function up() {
  await binaries();
  const bin = pgBin();
  for (const d of ["storage", "s3", "mail"]) fs.rmSync(path.join(STACK, d), { recursive: true, force: true });
  // fresh database every time: tests start from a known state
  try { asPg(path.join(bin, "pg_ctl"), ["-D", PGDATA, "-m", "immediate", "stop"], { stdio: "ignore" }); } catch {}
  fs.rmSync(PGDATA, { recursive: true, force: true }); fs.mkdirSync(PGDATA, { recursive: true }); if (ROOTUSER) execFileSync("chown", ["postgres", PGDATA]);
  asPg(path.join(bin, "initdb"), ["-D", PGDATA, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-instructions"], { stdio: "ignore" });
  fs.appendFileSync(path.join(PGDATA, "postgresql.conf"), `\nport = ${P.pg}\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = '${PGDATA}'\nmax_connections = 100\nfsync = off\nsynchronous_commit = off\n`);
  asPg(path.join(bin, "pg_ctl"), ["-D", PGDATA, "-l", path.join(PGDATA, "server.log"), "-w", "start"], { stdio: "ignore" });
  psql(path.join(ROOT, "scripts/stack/bootstrap.sql"));
  // Supabase Auth creates the auth schema itself
  start("auth", path.join(STACK, "bin/auth/auth"), [], {
    GOTRUE_DB_DRIVER: "postgres", DATABASE_URL: `postgres://supabase_auth_admin:stack@127.0.0.1:${P.pg}/postgres?sslmode=disable&search_path=auth`, GOTRUE_DB_MIGRATIONS_PATH: path.join(STACK, "bin/auth/migrations"),
    API_EXTERNAL_URL: `http://127.0.0.1:${P.gw}/auth/v1`, GOTRUE_API_HOST: "127.0.0.1", PORT: String(P.auth), GOTRUE_SITE_URL: ENV.NEXT_PUBLIC_SITE_URL, GOTRUE_URI_ALLOW_LIST: "*",
    GOTRUE_JWT_SECRET: SECRET, GOTRUE_JWT_EXP: "3600", GOTRUE_JWT_AUD: "authenticated", GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated", GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_DISABLE_SIGNUP: "true", GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", GOTRUE_MAILER_AUTOCONFIRM: "true", GOTRUE_SMTP_HOST: "127.0.0.1", GOTRUE_SMTP_PORT: String(P.smtp), GOTRUE_SMTP_ADMIN_EMAIL: "auth@agron-stack.test", GOTRUE_SMTP_USER: "x", GOTRUE_SMTP_PASS: "x",
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true", GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true", GOTRUE_MFA_MAX_ENROLLED_FACTORS: "10", GOTRUE_RATE_LIMIT_HEADER: "", GOTRUE_RATE_LIMIT_EMAIL_SENT: "1000", GOTRUE_RATE_LIMIT_VERIFY: "1000", GOTRUE_RATE_LIMIT_TOKEN_REFRESH: "1000", GOTRUE_RATE_LIMIT_OTP: "1000",
    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: "true", GOTRUE_LOG_LEVEL: "warn",
  });
  await wait(`http://127.0.0.1:${P.auth}/health`, 60000);
  psql(path.join(ROOT, "scripts/stack/post-auth.sql"));
  // the app's own SQL, in the order it was applied to production (seed.sql holds real company data and is skipped)
  for (const f of migrations()) { try { psql(path.join(ROOT, "supabase", f)); } catch (e) { throw new Error(`${f}: ${e.stderr?.toString() || e.message}`); } }
  psql(path.join(ROOT, "scripts/stack/post-migrate.sql"));
  start("rest", path.join(STACK, "bin/postgrest/postgrest"), [], { PGRST_DB_URI: `postgres://authenticator:stack@127.0.0.1:${P.pg}/postgres`, PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(P.rest), PGRST_SERVER_HOST: "127.0.0.1", PGRST_DB_POOL: "20", PGRST_LOG_LEVEL: "warn" });
  start("gateway", process.execPath, [path.join(ROOT, "scripts/stack/gateway.mjs")], { STACK_DIR: STACK, PG_URL, JWT_SECRET: SECRET, S3_KEY_ID: S3.id, S3_SECRET: S3.secret, GATEWAY_PORT: String(P.gw), AUTH_URL: `http://127.0.0.1:${P.auth}`, REST_URL: `http://127.0.0.1:${P.rest}`, SMTP_PORT: String(P.smtp) });
  await wait(`http://127.0.0.1:${P.rest}/`); await wait(`http://127.0.0.1:${P.gw}/health`);
  fs.writeFileSync(path.join(STACK, "env.json"), JSON.stringify(ENV, null, 1));
  log("up:", ENV.NEXT_PUBLIC_SUPABASE_URL);
  return ENV;
}
export function migrations() {
  const ups = fs.readdirSync(path.join(ROOT, "supabase")).filter((f) => /^update-v\d+\.sql$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  // access.sql (generated defaults) came after v17 in production; later updates build on it
  const pre = ups.filter((f) => +f.match(/\d+/)[0] <= 17), post = ups.filter((f) => +f.match(/\d+/)[0] > 17);
  return ["schema.sql", ...pre, "access.sql", ...post];
}
export function down() {
  for (const p of procs) try { p.kill("SIGTERM"); } catch {}
  try { asPg(path.join(pgBin(), "pg_ctl"), ["-D", PGDATA, "-m", "fast", "stop"], { stdio: "ignore" }); } catch {}
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "env") { process.stdout.write(fs.readFileSync(path.join(STACK, "env.json"))); process.exit(0); }
  try { await up(); } catch (e) { log("failed:", e.message); down(); process.exit(1); }
  process.on("SIGINT", () => { down(); process.exit(130); }); process.on("SIGTERM", () => { down(); process.exit(143); });
  if (cmd === "run") {
    const r = spawnSync(rest[0], rest.slice(1), { stdio: "inherit", env: { ...process.env, ...ENV }, cwd: ROOT });
    down(); process.exit(r.status ?? 1);
  } else { log("running — Ctrl+C to stop"); setInterval(() => {}, 1 << 30); }
}
