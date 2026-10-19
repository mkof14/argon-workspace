import { currentSession } from "./supabase";
import { meets, type Need } from "@/lib/roles";
import { adminClient } from "./supabase";

/**
 * One server-side gate for API routes: the person, their role and their session in one check.
 *   const g = await requireUser("admin"); if (g instanceof Response) return g; const me = g.me;
 * Answers 401 (not signed in / session ended), 403 with {code} (role, disabled, mfa_required).
 */
export async function requireUser(need: Need = "signed-in") {
  const s = await currentSession();
  if (!s) return Response.json({ code: "signin", message: "Not signed in" }, { status: 401 });
  if (s.blocked === "revoked") return Response.json({ code: "revoked", message: "This session was ended. Sign in again." }, { status: 401 });
  if (s.blocked === "disabled") return Response.json({ code: "disabled", message: "This account is switched off." }, { status: 403 });
  if (s.blocked === "mfa") return Response.json({ code: "mfa_required", message: "Confirm the sign-in with your authenticator app first." }, { status: 403 });
  const m = meets(s.profile, need, { mfaRequired: s.mfaRequired, aal: s.aal });
  if (!m.ok) return Response.json({ code: m.reason, message: m.reason === "role" ? "Not allowed for your role" : "Not signed in" }, { status: m.reason === "signin" ? 401 : 403 });
  return { me: s.profile as any, aal: s.aal, mfaRequired: s.mfaRequired };
}

/** The caller's address for request limits (Vercel puts the client first in x-forwarded-for). */
export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

/**
 * Request limit: at most `limit` calls per `windowSec` for the bucket (an IP address or a user). Uses one row per
 * window in the database (no extra service). Returns a 429 Response when the limit is passed, otherwise null.
 * If the counter cannot be reached the call is allowed (a limit must not take the site down).
 */
export async function limit(bucket: string, max: number, windowSec: number, db = adminClient()) {
  try {
    const { data, error } = await db.rpc("rate_hit", { p_bucket: bucket, p_limit: max, p_window_seconds: windowSec });
    if (error || data !== false) return null;
  } catch { return null; }
  return new Response("Too many requests — wait a moment and try again", { status: 429, headers: { "Retry-After": String(windowSec) } });
}
