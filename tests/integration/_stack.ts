// Shared helpers for the integration tests. They run only inside the isolated test stack
// (node scripts/stack/stack.mjs run …), never against production: the URL must be the local gateway.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

export const ENV = process.env as Record<string, string>;
export const URL_ = ENV.NEXT_PUBLIC_SUPABASE_URL || "";
if (!/^http:\/\/127\.0\.0\.1:/.test(URL_)) throw new Error("Integration tests run only against the local test stack (npm run test:int)");
export const APP = ENV.STACK_APP_URL || "";

const req = createRequire(path.join(ENV.STACK_DIR, "nm", "package.json"));
const { Pool } = req("pg");
export const pool = new Pool({ connectionString: ENV.STACK_PG_URL, max: 8 });
export const sql = async (q: string, p: any[] = []) => (await pool.query(q, p)).rows;

export const admin = (): SupabaseClient => createClient(URL_, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export const anon = (): SupabaseClient => createClient(URL_, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const b64u = (b: any) => Buffer.from(b).toString("base64url");
/** A JWT signed like Supabase signs it (for direct REST calls with chosen claims). */
export const jwt = (claims: Record<string, any>) => { const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", ...claims })); return `${h}.${p}.${createHmac("sha256", ENV.STACK_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
export const asJwt = (token: string): SupabaseClient => createClient(URL_, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });

export const PASSWORD = "Stack-Test-Password-1!";
/** A sign-in account with a profile (role, US-person flag, company). Synthetic people only. */
export async function makeUser(email: string, role: string, o: { us?: boolean; company?: string | null; name?: string } = {}) {
  const a = admin();
  const { data, error } = await a.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: o.name || email.split("@")[0] } });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const id = data.user!.id;
  const { error: e2 } = await a.from("profiles").update({ role, us_person: !!o.us, company: o.company ?? null, full_name: o.name || email.split("@")[0] }).eq("id", id);
  if (e2) throw new Error(`profile ${email}: ${e2.message}`);
  return { id, email, role };
}
/** Signs in with e-mail and password through Supabase Auth and returns a client acting as that person. */
export async function signIn(email: string, password = PASSWORD) {
  const c = createClient(URL_, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return { c, session: data.session!, token: data.session!.access_token };
}

/** E-mails caught by the stack's SMTP sink. */
export const mails = () => { const d = ENV.STACK_MAIL_DIR; return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))) : []; };
export const mailsTo = (addr: string) => mails().filter((m) => (m.to || []).includes(addr));
export const clearMail = () => { const d = ENV.STACK_MAIL_DIR; if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f)); };

/** RFC 6238 time-based one-time password (what an authenticator app shows). */
export function totp(secretB32: string, t = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const ch of secretB32.replace(/=+$/, "").toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", key).update(ctr).digest(); const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}
export const uid = () => Math.random().toString(36).slice(2, 10);
