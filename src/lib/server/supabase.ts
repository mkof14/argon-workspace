import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { COOKIE_OPTIONS } from "../cookies";
import { isPrivileged } from "../roles";

const URL_ = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Supabase client acting as the signed-in user (reads auth cookies). */
export async function userClient() {
  const store = await cookies();
  return createServerClient(URL_(), ANON(), {
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} },
    },
  });
}
/** Service-role client for server-only tasks (AI usage log, invitations). Never expose to the browser. */
export const adminClient = () => createClient(URL_(), process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

/** Claims of the access token that getUser() has just verified with the sign-in service. */
const claimsOf = (token?: string | null): Record<string, any> => { try { return JSON.parse(Buffer.from(String(token || "").split(".")[1] || "", "base64url").toString()); } catch { return {}; } };

export type Session = { profile: any; aal: string; iat: number; mfaRequired: boolean; blocked: null | "disabled" | "revoked" | "mfa" };
/** Who is calling, with the session facts every server check needs. null = not signed in. */
export async function currentSession(): Promise<Session | null> {
  const sb = await userClient();
  const { data: u } = await sb.auth.getUser();
  if (!u?.user) return null;
  const { data: s } = await sb.auth.getSession();
  const c = claimsOf(s.session?.access_token);
  const [{ data: profile }, { data: sec }] = await Promise.all([
    sb.from("profiles").select("*").eq("id", u.user.id).single(),
    sb.from("security_settings").select("mfa_required").maybeSingle(),
  ]);
  if (!profile) return null;
  const aal = String(c.aal || "aal1"); const iat = Number(c.iat || 0); const mfaRequired = !!sec?.mfa_required;
  const revoked = profile.sessions_revoked_at && iat <= Math.floor(Date.parse(profile.sessions_revoked_at) / 1000);
  const blocked = profile.disabled ? "disabled" : revoked ? "revoked" : isPrivileged(profile.role) && mfaRequired && aal !== "aal2" ? "mfa" : null;
  return { profile: { ...profile, _aal: aal }, aal, iat, mfaRequired, blocked };
}

/**
 * The signed-in person's profile, or null. A disabled account, an ended session, and an owner/administrator
 * session without the second factor (once it is required) count as not signed in for every server route.
 */
export async function currentProfile() {
  const s = await currentSession();
  return s && !s.blocked ? (s.profile as any) : null;
}
