// Phase 7 — pure commercial helpers: the Assistant's commercial intents, the business-card / QR parsers (a field exists
// only if it is written on the card), CSV import/export and currency display (never a default currency).
import { test } from "node:test";
import assert from "node:assert/strict";
import { crmIntent, parseCardText, parseContactCode } from "../src/lib/crmText.ts";
import { amount, amounts, parseCsv, toCsv } from "../src/lib/crmApi.ts";
import { crmWeeklyLines } from "../src/lib/mgmt.ts";

test("commercial intents (EN/RU)", () => {
  assert.equal(crmIntent("Who do I need to follow up with today?")?.intent, "followup_today");
  assert.equal(crmIntent("С кем мне связаться сегодня?")?.intent, "followup_today");
  assert.equal(crmIntent("Which opportunities need my attention?")?.intent, "attention");
  assert.equal(crmIntent("Which proposals are waiting for a response?")?.intent, "proposals_waiting");
  assert.equal(crmIntent("Which opportunities are stalled?")?.intent, "stalled");
  assert.deepEqual(crmIntent("Who introduced us to Harbor Marine?"), { intent: "introduced_by", arg: "Harbor Marine" });
  assert.deepEqual(crmIntent("Show opportunities above $1M"), { intent: "above_value", arg: "1000000 USD" });
  assert.equal(crmIntent("What came from IDEX 2027?")?.arg, "IDEX 2027");
  assert.equal(crmIntent("Prepare the commercial review")?.intent, "review");
  assert.equal(crmIntent("What is the weather?"), null);
});

test("vCard and MECARD from a QR code", () => {
  const v = parseContactCode("BEGIN:VCARD\nVERSION:3.0\nN:Haddad;Layla\nORG:Harbor Marine LLC\nTITLE:Fleet Director\nEMAIL:LAYLA@HARBOR.AE\nTEL:+971 50 123 4567\nADR:;;Port Rd;Abu Dhabi;;;UAE\nEND:VCARD");
  assert.deepEqual(v, { first_name: "Layla", last_name: "Haddad", organization: "Harbor Marine LLC", title: "Fleet Director", email: "layla@harbor.ae", phone: "+971 50 123 4567", country: "UAE" });
  const m = parseContactCode("MECARD:N:Saeed,Omar;TEL:+97150000000;EMAIL:omar@x.ae;;");
  assert.equal(m.first_name, "Omar"); assert.equal(m.last_name, "Saeed"); assert.equal(m.email, "omar@x.ae");
});

test("business card text: only what is written", () => {
  const f = parseCardText("Layla Haddad\nFleet Director\nHarbor Marine LLC\n+971 50 123 4567\nlayla@harbor.ae\nwww.harbor.ae");
  assert.equal(f.first_name, "Layla"); assert.equal(f.last_name, "Haddad"); assert.equal(f.title, "Fleet Director");
  assert.equal(f.organization, "Harbor Marine LLC"); assert.equal(f.email, "layla@harbor.ae"); assert.equal(f.website, "www.harbor.ae");
  assert.equal(f.country, undefined, "no country is invented");
  assert.deepEqual(parseCardText(""), {});
});

test("CSV in and out (quotes, commas, semicolons, BOM)", () => {
  const rows = parseCsv('﻿Name,Email,Relationship Types\n"Harbor Marine, LLC",info@harbor.ae,Prospect;Customer\n\n');
  assert.deepEqual(rows, [{ name: "Harbor Marine, LLC", email: "info@harbor.ae", relationship_types: "Prospect;Customer" }]);
  assert.deepEqual(parseCsv("name;country\nA;UAE"), [{ name: "A", country: "UAE" }]);
  const out = toCsv([{ a: 1, b: 'x "y"' }, { a: 2, c: [1, 2] }]);
  assert.equal(out, 'a,b,c\n1,"x ""y""",\n2,,"[1,2]"');
});

test("values keep their currency — never a default, never added across", () => {
  assert.equal(amount(2500000, "USD"), "2,500,000 USD");
  assert.equal(amount(1000, null), "1,000 (no currency)");
  assert.equal(amount(null, "USD"), "—");
  assert.equal(amounts({ USD: 10, AED: 20 }), "10 USD · 20 AED");
});

test("weekly review commercial lines name their records", () => {
  const l = crmWeeklyLines({ summary: { active: 3, new: 1, won: 1, lost: 0, stalled: 1, risk: 0, proposals_outstanding: 2 }, wins: [{ id: "x1", number: "AGR-OPP-2026-0001", title: "Harbor", final: 2750000, currency: "USD" }] }, "en");
  assert.match(l[0].text, /Active 3/); assert.ok(l.some((x) => x.link === "/crm?opp=x1" && /2,750,000 USD/.test(x.text)));
  assert.match(l[l.length - 1].text, /not revenue/);
});
