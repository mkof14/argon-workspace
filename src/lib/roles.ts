// Who is who, in one place: internal staff, external users, privileged accounts. Used by every server route
// (lib/server/authz.ts) and by the interface, so a role check is never written differently twice.
export const INTERNAL_ROLES = ["owner", "admin", "management", "engineering", "operations", "finance", "sales", "marketing", "hr", "legal", "security"] as const;
export const EXTERNAL_ROLES = ["partner", "vendor", "investor"] as const;
export const PRIVILEGED_ROLES = ["owner", "admin"] as const;
export const LEAD_ROLES = ["owner", "admin", "management"] as const;

export const isInternal = (role?: string | null) => !!role && (INTERNAL_ROLES as readonly string[]).includes(role);
export const isExternalRole = (role?: string | null) => !!role && (EXTERNAL_ROLES as readonly string[]).includes(role);
export const isPrivileged = (role?: string | null) => !!role && (PRIVILEGED_ROLES as readonly string[]).includes(role);
export const isLead = (role?: string | null) => !!role && (LEAD_ROLES as readonly string[]).includes(role);

export type Need = "signed-in" | "internal" | "lead" | "admin" | "owner";
/** Does a profile meet a requirement? `mfa` = the session has a second factor (aal2). */
export function meets(p: { role?: string | null; disabled?: boolean } | null | undefined, need: Need, opts: { mfaRequired?: boolean; aal?: string | null } = {}): { ok: boolean; reason?: "signin" | "role" | "mfa" | "disabled" } {
  if (!p || !p.role || p.role === "pending") return { ok: false, reason: "signin" };
  if (p.disabled) return { ok: false, reason: "disabled" };
  const role = p.role;
  const okRole = need === "signed-in" ? true : need === "internal" ? isInternal(role) : need === "lead" ? isLead(role) : need === "admin" ? isPrivileged(role) : role === "owner";
  if (!okRole) return { ok: false, reason: "role" };
  if (isPrivileged(role) && opts.mfaRequired && opts.aal !== "aal2") return { ok: false, reason: "mfa" };
  return { ok: true };
}
