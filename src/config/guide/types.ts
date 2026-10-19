// Texts of the AGRON Workspace user guide (the parts that are not taken from the Learning Center handbook,
// section help, glossary and FAQ). One file per language; keep the four files in step when anything changes.
export type GuideLang = "en" | "ru" | "uk" | "ar";
export type GuideText = {
  ABOUT: string; HOWTO: string; UI: string; RHYTHM: string; RULES: string; LAUNCH: string;
  ROLES_START: [string, string][]; FLOW: [string, string][];
  /** Labels and short texts; {placeholders} are filled by lib/guidemodel. */
  S: Record<string, string>;
  /** What each role means (role key → text). */
  ROLE_DESC: Record<string, string>;
};
export const GUIDE_LANGS: GuideLang[] = ["en", "ru", "uk", "ar"];
