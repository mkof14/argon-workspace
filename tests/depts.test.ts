// Department KPIs, portals and external links.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allSections, METRIC_KPIS } from "../src/config/workspace.config.mjs";
import { PORTALS } from "../src/config/portals.ts";
import { trackUrl, usptoUrl } from "../src/lib/links.ts";

test("Every department with KPIs has a metrics section holding all of them", () => {
  const secs = allSections() as any[];
  for (const [dept, kpis] of Object.entries(METRIC_KPIS as Record<string, any[]>)) {
    const s = secs.find((x) => x.id === `${dept}.metrics`); assert.ok(s, dept);
    for (const k of kpis) assert.ok(s.fields.some((f: any) => f.key === k.key), `${dept}.${k.key}`);
    assert.ok(s.fields.some((f: any) => f.key === "period"));
  }
});

test("Portals are public https links with four languages", () => {
  for (const list of Object.values(PORTALS)) for (const p of list) {
    assert.match(p.url, /^https:\/\//); for (const l of ["en", "ru", "uk", "ar"]) assert.ok((p.what as any)[l], p.name);
  }
});

test("Tracking and trademark links", () => {
  assert.equal(trackUrl("Maersk", " MSKU1234567 "), "https://www.maersk.com/tracking/MSKU1234567");
  assert.equal(trackUrl("Other", "123"), "");
  assert.equal(trackUrl("DHL", ""), "");
  assert.match(usptoUrl("97/123,456"), /caseNumber=97123456/);
  assert.equal(usptoUrl("123"), "");
});

import { REFS, CHAIN, chainOf } from "../src/config/links.ts";
test("Links point to real sections and fields, and the chain walks both ways", () => {
  const secs = allSections() as any[];
  for (const [sec, m] of Object.entries(REFS)) { const s = secs.find((x) => x.id === sec); assert.ok(s, sec);
    for (const [k, t] of Object.entries(m)) { assert.ok(s.fields.some((f: any) => f.key === k && f.type === "ref" && f.ref === t), `${sec}.${k}`); assert.ok(secs.some((x) => x.id === t), t); assert.ok(CHAIN.includes(sec) && CHAIN.includes(t)); } }
  const n = (id: string, section: string, data: any = {}) => ({ id, section, title: id, status: null, data });
  const deal = n("d", "sales.pipeline", { client_ref: "c" }), client = n("c", "sales.clients"), build = n("b", "operations.builds", { deal_ref: "d" }), ship = n("s", "operations.logistics", { build_ref: "b" }), other = n("x", "operations.builds", { deal_ref: "zzz" });
  const chain = chainOf(ship as any, [deal, client, build, ship, other] as any);
  assert.deepEqual(chain.map((r) => r.id), ["c", "d", "b", "s"]);
});
