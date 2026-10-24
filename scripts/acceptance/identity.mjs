// Release identity used by the build (next.config.mjs) and by every evidence recorder: Git SHA, uncommitted changes,
// app and database version, and the migration set hash (SHA-256 over supabase/update-v*.sql in version order).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const ROOT = new URL("../../", import.meta.url).pathname;
export function migrationHash(root = ROOT) {
  const dir = path.join(root, "supabase");
  const files = fs.readdirSync(dir).filter((f) => /^update-v\d+\.sql$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  const h = crypto.createHash("sha256");
  for (const f of files) h.update(`${f}\n`).update(fs.readFileSync(path.join(dir, f)));
  return { hash: h.digest("hex"), files: files.length, last: files.at(-1) };
}
export function gitSha(root = ROOT) {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
}
/** true when tracked files differ from the commit (untracked build output and ignored files do not count) */
export function dirty(root = ROOT) {
  if (process.env.VERCEL) return false;
  try { return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0; } catch { return true; }
}
export function versions(root = ROOT) {
  const v = fs.readFileSync(path.join(root, "src/lib/version.ts"), "utf8");
  return { app_version: (v.match(/APP_VERSION\s*=\s*"([^"]+)"/) || [])[1] || "", db_version: Number((v.match(/DB_VERSION\s*=\s*(\d+)/) || [])[1] || 0) };
}
export function identity(environment, root = ROOT) {
  const m = migrationHash(root);
  return { environment, ...versions(root), git_sha: gitSha(root), dirty: dirty(root), migration_hash: m.hash };
}
