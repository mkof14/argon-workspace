// Backups: ZIP round trip, server encryption opened by the browser code, data packing; KPI collection from records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeZip, readZip, crc32 } from "../src/lib/zip.ts";
import { encrypt, decrypt, pack, unpack } from "../src/lib/server/backup.ts";
import { decryptBytes, encryptBytes, gunzip, isEncrypted, isGzip, isZip } from "../src/lib/backupCrypto.ts";
import { collectMonth } from "../src/lib/kpiAuto.ts";

test("ZIP written in the browser reads back, including UTF-8 names", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const z = makeZip([{ name: "data.json", data: new TextEncoder().encode('{"a":1}') }, { name: "files/hr.team/x/Договор.pdf", data: new Uint8Array([1, 2, 3]) }]);
  assert.ok(isZip(z));
  const r = readZip(z);
  assert.equal(new TextDecoder().decode(r["data.json"]), '{"a":1}');
  assert.deepEqual([...r["files/hr.team/x/Договор.pdf"]], [1, 2, 3]);
});

test("A backup encrypted on the server opens in the browser, and the other way round", async () => {
  const data = { records: [{ id: "1", title: "Test" }] };
  const gz = pack(data);
  const file = encrypt(gz, "correct horse battery");
  assert.ok(isEncrypted(new Uint8Array(file)));
  const plain = await decryptBytes(new Uint8Array(file), "correct horse battery");
  assert.ok(isGzip(plain));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(await gunzip(plain))), data);
  await assert.rejects(decryptBytes(new Uint8Array(file), "wrong password"));
  const back = await encryptBytes(new Uint8Array(gz), "pw-12345678");
  assert.deepEqual(unpack(decrypt(Buffer.from(back), "pw-12345678")), data);
});

test("Collect the month counts from records", () => {
  const p = "2026-10";
  const r = (section: string, status: string, data: any, extra: any = {}) => ({ id: Math.random().toString(), section, title: "x", status, data, created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-06T10:00:00Z", ...extra } as any);
  const recs = [
    r("security.screening", "Cleared", { date: "2026-10-02" }), r("security.screening", "Flagged", { date: "2026-10-03" }), r("security.screening", "Cleared", { date: "2026-09-03" }),
    r("sales.pipeline", "Won", { value: 100000, currency: "USD" }), r("sales.pipeline", "Qualified", { value: 50000 }),
    r("hr.team", "Active", { start: "2026-10-01" }), r("hr.team", "Left", {}),
  ];
  assert.deepEqual([collectMonth("security", recs, p).values.screenings, collectMonth("security", recs, p).values.flagged], [2, 1]);
  const s = collectMonth("sales", recs, p).values;
  assert.deepEqual([s.won_deals, s.won_value, s.pipeline_value], [1, 100000, 50000]);
  const h = collectMonth("hr", recs, p).values;
  assert.deepEqual([h.headcount, h.hires, h.leavers], [1, 1, 1]);
});
