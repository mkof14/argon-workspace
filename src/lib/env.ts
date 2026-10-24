// Which environment this build is, and which database it may use. Fails closed: when the settings are ambiguous the
// build connects to no database at all (P9-R1 R2).
//
//   production   the production deployment (Vercel production target). Connects to the project in its own settings;
//                the anon key must belong to that same project, and it must not be the staging project.
//   staging      a preview deployment that opts in: NEXT_PUBLIC_APP_ENV=staging AND NEXT_PUBLIC_STAGING_SUPABASE_REF
//                naming the staging project, AND a Supabase URL and anon key of exactly that project. A preview that
//                inherits the production key or URL is refused — staging never falls back to production credentials.
//   preview      any other preview deployment: no database (demo data only).
//   development  a local build (tests, the isolated stack): a local database, or the staging project with the same
//                explicit opt-in as above. A local build pointed at any other hosted project is refused.
//
// NEXT_PUBLIC_DEPLOY_ENV and NEXT_PUBLIC_RELEASE_SHA are set at build time from Vercel's VERCEL_ENV and
// VERCEL_GIT_COMMIT_SHA (next.config.mjs), so the browser and the server agree.
export type AppEnv = "production" | "staging" | "preview" | "development";
export type EnvInput = { deploy?: string; flag?: string; url?: string; anon?: string; stagingRef?: string };
export type EnvDecision = { env: AppEnv; db: boolean; refused: string | null };

/** The project ref inside a Supabase anon/service JWT, or null for keys that carry none (sb_publishable_…, sb_secret_…). */
export function keyRef(key?: string | null): string | null {
  try {
    const part = String(key || "").split(".")[1]; if (!part) return null;
    const json = typeof atob === "function" ? atob(part.replace(/-/g, "+").replace(/_/g, "/")) : Buffer.from(part, "base64url").toString();
    const ref = JSON.parse(json)?.ref; return typeof ref === "string" && ref ? ref : null;
  } catch { return null; }
}
/** The project ref of a hosted Supabase URL (https://<ref>.supabase.co), "local" for a local/test host, null otherwise. */
export function urlRef(url?: string | null): string | null {
  try {
    const h = new URL(String(url || "")).hostname;
    const m = h.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/); if (m) return m[1];
    if (h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h.endsWith(".localhost") || h.endsWith(".test")) return "local";
    return null;
  } catch { return null; }
}

export function decideEnv(i: EnvInput): EnvDecision {
  const d = String(i.deploy || "").toLowerCase(), f = String(i.flag || "").toLowerCase().trim();
  const url = i.url || "", ref = urlRef(url), kref = keyRef(i.anon), sref = String(i.stagingRef || "").trim();
  const refuse = (env: AppEnv, why: string): EnvDecision => ({ env, db: false, refused: why });
  const noDb = !url || !i.anon;
  if (d === "production") {
    if (f && f !== "production") return refuse("production", `production deployment marked "${f}"`);
    if (noDb) return { env: "production", db: false, refused: null };
    if (!ref || ref === "local") return refuse("production", "production points at a database that is not a hosted Supabase project");
    if (kref && kref !== ref) return refuse("production", "the anon key belongs to a different project than the URL");
    if (sref && sref === ref) return refuse("production", "production points at the staging project");
    return { env: "production", db: true, refused: null };
  }
  const staging = (env: AppEnv): EnvDecision => {
    if (!sref) return refuse(env, "staging needs NEXT_PUBLIC_STAGING_SUPABASE_REF");
    if (noDb) return refuse(env, "staging needs its Supabase URL and anon key");
    if (ref !== sref) return refuse(env, "the Supabase URL is not the staging project");
    if (kref && kref !== sref) return refuse(env, "the anon key is not the staging project's (no fallback to other credentials)");
    return { env, db: true, refused: null };
  };
  if (d === "preview") {
    if (f === "staging") return staging("staging");
    if (f && f !== "preview") return refuse("preview", `preview deployment marked "${f}"`);
    return { env: "preview", db: false, refused: null };
  }
  if (f === "staging") return staging("staging");
  if (f === "production") return refuse("development", "a local build cannot be production");
  if (noDb) return { env: "development", db: false, refused: null };
  if (ref === "local") return { env: "development", db: true, refused: null };
  return refuse("development", "a local build may use only a local database or the staging project (opt-in)");
}

export const ENV_DECISION: EnvDecision = decideEnv({
  deploy: process.env.NEXT_PUBLIC_DEPLOY_ENV, flag: process.env.NEXT_PUBLIC_APP_ENV,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, stagingRef: process.env.NEXT_PUBLIC_STAGING_SUPABASE_REF,
});
export const APP_ENV: AppEnv = ENV_DECISION.env;
/** Why the build refused its database settings (null = accepted or none given). */
export const ENV_REFUSED: string | null = ENV_DECISION.refused;
export const dbAllowed = () => ENV_DECISION.db;
export const SUPABASE_URL = ENV_DECISION.db ? process.env.NEXT_PUBLIC_SUPABASE_URL || "" : "";
export const SUPABASE_ANON = ENV_DECISION.db ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" : "";
export const RELEASE_SHA = (process.env.NEXT_PUBLIC_RELEASE_SHA || "").slice(0, 12);
export const RELEASE_AT = process.env.NEXT_PUBLIC_RELEASE_AT || "";

/** A server key may be used only with the project it belongs to (keys without a ref are accepted). */
export function serverKeyAllowed(key?: string | null, url: string = SUPABASE_URL): boolean {
  if (!url || !key) return false;
  const k = keyRef(key), r = urlRef(url);
  return !k || k === r;
}

/** Banner text for staging and plain preview builds (none in production; development shows only a footer label). */
export function envBanner(e: AppEnv = APP_ENV): null | Record<"en" | "ru" | "uk" | "ar", string> {
  if (e === "staging") return { en: "STAGING — test environment with test data. Nothing here is real company data.", ru: "STAGING — тестовая среда с тестовыми данными. Здесь нет реальных данных компании.", uk: "STAGING — тестове середовище з тестовими даними. Тут немає реальних даних компанії.", ar: "STAGING — بيئة اختبار ببيانات اختبار. لا توجد هنا بيانات حقيقية للشركة." };
  if (e === "preview") return { en: "PREVIEW — not connected to any database (demo data only).", ru: "PREVIEW — не подключено ни к одной базе данных (только демо-данные).", uk: "PREVIEW — не підключено до жодної бази даних (лише демо-дані).", ar: "PREVIEW — غير متصل بأي قاعدة بيانات (بيانات تجريبية فقط)." };
  return null;
}
/** Short label shown next to the version in the footer (none in production). */
export const envLabel = (e: AppEnv = APP_ENV) => (e === "production" ? "" : e.toUpperCase());

/** The text shown instead of the app when production or staging refused its settings (fail closed, no demo data). */
export const REFUSED_TEXT = {
  en: "Workspace is not available: this deployment's database settings were refused as unsafe. An administrator must correct them.",
  ru: "Workspace недоступен: настройки базы данных этой сборки отклонены как небезопасные. Их должен исправить администратор.",
  uk: "Workspace недоступний: налаштування бази даних цієї збірки відхилено як небезпечні. Їх має виправити адміністратор.",
  ar: "Workspace غير متاح: رُفضت إعدادات قاعدة البيانات لهذا النشر لأنها غير آمنة. يجب أن يصححها مسؤول.",
};

/**
 * Outbound e-mail outside production goes only to the addresses or domains listed in MAIL_ALLOWED_DOMAINS
 * (comma-separated: "qa@agron1.com" = that mailbox and its +tags, "agron1.com" = the whole domain); with no list nothing
 * leaves a non-production environment.
 * Returns the recipients that may not be sent to (empty = all allowed).
 */
export function blockedRecipients(to: string | string[], e: AppEnv = APP_ENV, allow = process.env.MAIL_ALLOWED_DOMAINS || ""): string[] {
  if (e === "production") return [];
  const ok = allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = (Array.isArray(to) ? to : String(to || "").split(",")).map((s) => s.trim()).filter(Boolean);
  // an entry with "@" allows exactly that address (a test mailbox, e.g. qa@agron1.com and its +tags); otherwise a domain
  const base = (addr: string) => addr.replace(/\+[^@]*@/, "@");
  return list.filter((a) => { const m = a.toLowerCase().match(/<?([^<>\s]+@([^<>\s]+?))>?$/); return !m || !(ok.includes(m[2]) || ok.includes(m[1]) || ok.includes(base(m[1]))); });
}
