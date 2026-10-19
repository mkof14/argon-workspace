/**
 * Server-side errors go to the same app_errors table the interface uses (Administration → System → Health),
 * so an administrator sees background failures without server logs. Never throws.
 */
export async function reportError(db: any, source: string, err: unknown, ctx: { url?: string; detail?: string } = {}) {
  const e = err as any; const message = String(e?.message || e || "Unknown error").slice(0, 1000);
  try {
    // source is one of client/server/uptime; the part of the system that failed goes into "agent"
    const { error } = await db.from("app_errors").insert({ source: "server", agent: source.slice(0, 300), message: message.slice(0, 2000), stack: [e?.stack ? String(e.stack).slice(0, 4000) : "", ctx.detail || ""].filter(Boolean).join("\n\n").slice(0, 8000) || null, url: ctx.url?.slice(0, 500) || null, user_id: null, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null });
    if (error) console.error("[errors] could not record:", error.message);
  } catch {}
  try { console.error(`[${source}]`, message); } catch {}
}
/** Runs a step whose failure must not stop the caller, but must be visible. */
export async function guarded<T>(db: any, source: string, fn: () => Promise<T>, fallback: T, ctx: { url?: string; detail?: string } = {}): Promise<T> {
  try { return await fn(); } catch (e) { await reportError(db, source, e, ctx); return fallback; }
}
