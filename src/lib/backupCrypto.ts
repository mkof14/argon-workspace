// Password encryption for backup files in the browser. Same format as the server (src/lib/server/backup.ts):
// "AGRONBK1" | salt 16 | iv 12 | AES-256-GCM ciphertext + tag; key = PBKDF2-SHA256(password, salt, 250 000).
const MAGIC = "AGRONBK1"; const ITER = 250_000;
async function key(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITER }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encryptBytes(plain: Uint8Array, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(password, salt), plain as BufferSource));
  const out = new Uint8Array(36 + ct.length); out.set(new TextEncoder().encode(MAGIC)); out.set(salt, 8); out.set(iv, 24); out.set(ct, 36); return out;
}
export const isEncrypted = (b: Uint8Array) => new TextDecoder().decode(b.subarray(0, 8)) === MAGIC;
export async function decryptBytes(file: Uint8Array, password: string): Promise<Uint8Array> {
  if (!isEncrypted(file)) throw new Error("Not an encrypted AGRON backup");
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: file.subarray(24, 36) as BufferSource }, await key(password, file.subarray(8, 24)), file.subarray(36) as BufferSource)); }
  catch { throw new Error("Wrong password or damaged file"); }
}
export async function gunzip(b: Uint8Array): Promise<Uint8Array> { return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()); }
export const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
export const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
