// Which environment this build is, and whether it may connect to a database at all.
//
//   production   the production deployment (Vercel production target)
//   staging      a preview deployment explicitly configured for the staging project (NEXT_PUBLIC_APP_ENV=staging)
//   preview      any other preview deployment: it never connects to a database (demo mode), so an unfinished branch
//                cannot read or write production data even when the project-wide variables point at production
//   development  a local build (tests, the isolated stack)
//
// NEXT_PUBLIC_DEPLOY_ENV and NEXT_PUBLIC_RELEASE_SHA are set at build time from Vercel's VERCEL_ENV and
// VERCEL_GIT_COMMIT_SHA (next.config.mjs), so the browser and the server agree.
export type AppEnv = "production" | "staging" | "preview" | "development";

export function envOf(deploy: string | undefined, flag: string | undefined): AppEnv {
  const d = String(deploy || "").toLowerCase(), f = String(flag || "").toLowerCase();
  if (d === "production") return "production";
  if (f === "staging") return "staging";
  if (d === "preview") return "preview";
  return "development";
}
export const APP_ENV: AppEnv = envOf(process.env.NEXT_PUBLIC_DEPLOY_ENV, process.env.NEXT_PUBLIC_APP_ENV);
/** A plain preview build has no database: the connection settings are ignored. */
export const dbAllowed = (e: AppEnv = APP_ENV) => e !== "preview";
export const SUPABASE_URL = dbAllowed() ? process.env.NEXT_PUBLIC_SUPABASE_URL || "" : "";
export const SUPABASE_ANON = dbAllowed() ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" : "";
export const RELEASE_SHA = (process.env.NEXT_PUBLIC_RELEASE_SHA || "").slice(0, 12);
export const RELEASE_AT = process.env.NEXT_PUBLIC_RELEASE_AT || "";

/** Banner text for staging and plain preview builds (none in production; none for local builds and the test stack). */
export function envBanner(e: AppEnv = APP_ENV): null | Record<"en" | "ru" | "uk" | "ar", string> {
  if (e === "staging") return { en: "STAGING — test environment with test data. Nothing here is real company data.", ru: "STAGING — тестовая среда с тестовыми данными. Здесь нет реальных данных компании.", uk: "STAGING — тестове середовище з тестовими даними. Тут немає реальних даних компанії.", ar: "STAGING — بيئة اختبار ببيانات اختبار. لا توجد هنا بيانات حقيقية للشركة." };
  if (e === "preview") return { en: "PREVIEW — not connected to any database (demo data only).", ru: "PREVIEW — не подключено ни к одной базе данных (только демо-данные).", uk: "PREVIEW — не підключено до жодної бази даних (лише демо-дані).", ar: "PREVIEW — غير متصل بأي قاعدة بيانات (بيانات تجريبية فقط)." };
  return null;
}

/**
 * Outbound e-mail outside production goes only to addresses whose domain is listed in MAIL_ALLOWED_DOMAINS
 * (comma-separated, e.g. "agron1.com"); with no list nothing leaves a non-production environment.
 * Returns the recipients that may not be sent to (empty = all allowed).
 */
export function blockedRecipients(to: string | string[], e: AppEnv = APP_ENV, allow = process.env.MAIL_ALLOWED_DOMAINS || ""): string[] {
  if (e === "production") return [];
  const ok = allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = (Array.isArray(to) ? to : String(to || "").split(",")).map((s) => s.trim()).filter(Boolean);
  return list.filter((a) => { const m = a.toLowerCase().match(/<?([^<>\s]+@([^<>\s]+?))>?$/); return !m || !ok.includes(m[2]); });
}
