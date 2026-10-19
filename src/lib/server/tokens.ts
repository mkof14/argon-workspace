import { createHash, randomBytes } from "node:crypto";
/** Secret link tokens: the link carries the token, the database keeps only its SHA-256 (approvals, calendar feeds, client portal). */
export const newToken = () => randomBytes(24).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(String(t)).digest("hex");
