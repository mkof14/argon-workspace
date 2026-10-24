import { adminClient } from "./supabase";
import { isUninvited } from "../registration";
export { isUninvited };

/**
 * Registration safety (Phase 9-R1, R4). Workspace accounts are created by invitation only. If Supabase Auth still accepts
 * a public sign-up (e-mail sign-up or a first "Sign in with Google"), the new account arrives with role "pending" and no
 * invitation. Such a session is ended here at once and the attempt is written to the security log, so an uninvited
 * person never stays signed in. Invited people waiting for a role (invitation present, role "pending") are unaffected.
 *
 * Returns true when the session was refused.
 */
export async function refuseUninvited(sb: any): Promise<boolean> {
  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return false;
    const { data: profile } = await sb.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
    if (!isUninvited(user, profile)) return false;
    await sb.auth.signOut().catch(() => {});
    try {
      await adminClient().from("activity").insert({ record_id: null, section: "security.log", actor: user.id, action: "uninvited_sign_in_refused",
        detail: { email: user.email, provider: user.app_metadata?.provider || null } });
    } catch {}
    return true;
  } catch { return false; }
}

export const NO_INVITATION = "There is no Workspace account for this e-mail. Ask an administrator for an invitation.";
