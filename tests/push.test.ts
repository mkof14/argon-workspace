import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { b64u, encrypt } from "../src/lib/webpush.ts";

// Decrypts the way a browser does (RFC 8291) to prove the message can be read only with the device keys.
test("push message encrypts so the device can decrypt it", () => {
  const ua = crypto.createECDH("prime256v1"); const uaPub = ua.generateKeys(); const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: "Нужно ваше решение", body: "КП для Skyline" });
  const out = encrypt(msg, b64u(uaPub), b64u(auth));
  const salt = out.subarray(0, 16); const rs = out.readUInt32BE(16); const idlen = out[20]; const asPub = out.subarray(21, 21 + idlen); const ct = out.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(plain.subarray(0, plain.length - 1).toString(), msg);
});
