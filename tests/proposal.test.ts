import { test } from "node:test";
import assert from "node:assert/strict";
import { nextNumber, proposalMarkdown, totals } from "../src/lib/proposal.ts";

test("totals apply the discount and the quantity", () => {
  assert.deepEqual(totals({ qty: 2, unit: 1_000_000, discount: 5, lease: { month: 30000, term: 36 } }), { qty: 2, net: 950000, total: 1900000, lease: 60000 });
  assert.equal(totals({ qty: 0, unit: 100, discount: 150, lease: null }).total, 0);
});

test("proposal numbers continue within the year", () => {
  assert.equal(nextNumber(["P-2026-001", "P-2026-009", "P-2025-044", "x"], 2026), "P-2026-010");
  assert.equal(nextNumber([], 2027), "P-2027-001");
});

test("the document carries prices, terms, validity and the export clause", () => {
  const base = { number: "P-2026-003", date: "2026-10-17", client: "Skyline Marina", contact: "Ahmed", site: "Skyline Marina, Abu Dhabi", config: "C40 Advanced", qty: 1, unit: 1250000, discount: 4, currency: "USD", lease: { month: 32000, term: 48 }, terms: "30/40/30", delivery_weeks: 14, valid_days: 30, sender: { name: "Michael Kofman", title: "CEO" } };
  const en = proposalMarkdown(base, "en");
  assert.equal(en.total, 1200000); assert.equal(en.valid_until, "2026-11-16");
  assert.match(en.md, /USD 1,200,000/); assert.match(en.md, /export control/); assert.match(en.md, /30% advance, 40% before shipping/); assert.match(en.md, /USD 32,000 per month for 48 months/);
  const ru = proposalMarkdown(base, "ru");
  assert.match(ru.md, /Коммерческое предложение P-2026-003/); assert.match(ru.md, /экспортного контроля/);
});

import { calendarRecords, matchClient, openDeal, toEvent } from "../src/lib/gcalmatch.ts";
test("calendar: my meetings go out, client meetings come back to the right deal", () => {
  const recs: any[] = [
    { id: "a", section: "sales.activities", title: "Demo at the marina", status: "Planned", data: { owner: "Anna Petrova", date: "2026-10-20", client: "Skyline Marina" } },
    { id: "b", section: "sales.activities", title: "Other's call", status: "Planned", data: { owner: "Ivan", date: "2026-10-21" } },
    { id: "c", section: "company.meetings", title: "Board", status: "Scheduled", data: { participants: "Anna, Michael", date: "2026-10-22" } },
  ];
  assert.deepEqual(calendarRecords(recs, { full_name: "Anna Petrova", email: "anna@agron1.com" }).map((r) => r.id), ["a", "c"]);
  const ev = toEvent(recs[0], "https://workspace.agron1.com");
  assert.equal(ev.start.date, "2026-10-20"); assert.equal(ev.end.date, "2026-10-21"); assert.match(ev.description, /\?r=a/);
  const clients: any[] = [{ id: "k1", section: "sales.clients", title: "Skyline Marina", status: "Active", data: { contact: "Ahmed — ahmed@skyline-marina.ae" } }, { id: "k2", section: "sales.clients", title: "Gulf Ports", status: "Active", data: {} }];
  assert.equal(matchClient({ id: "e1", attendees: [{ email: "me@agron1.com", self: true }, { email: "sara@skyline-marina.ae" }] }, clients)?.id, "k1");
  assert.equal(matchClient({ id: "e2", summary: "Lunch", attendees: [{ email: "friend@gmail.com" }] }, clients), null);
  assert.equal(matchClient({ id: "e3", summary: "Call with Gulf Ports", attendees: [{ email: "x@gulfports.com" }] }, clients)?.id, "k2");
  assert.equal(matchClient({ id: "e4", summary: "Gulf Ports internal prep" }, clients), null);
  const deals: any[] = [{ id: "d1", section: "sales.pipeline", title: "x", status: "Won", data: { client_ref: "k1" } }, { id: "d2", section: "sales.pipeline", title: "y", status: "Proposal", data: { client_ref: "k1" } }];
  assert.equal(openDeal(deals, clients[0])?.id, "d2");
});
