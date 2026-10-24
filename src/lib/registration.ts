/** An account that registered itself: role "pending" and no invitation (P9-R1 R4). Invited people waiting for a role are not. */
export function isUninvited(user: { invited_at?: string | null } | null, profile: { role?: string | null } | null) {
  if (!user || !profile) return false;
  return profile.role === "pending" && !user.invited_at;
}
