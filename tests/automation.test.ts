import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, DEFAULT_SETTINGS, condOk, dateDue, describe, isWorkday, matchEvent, qualityIssues, render, withDefaults, aiCost, type Rule } from "../src/lib/automation.ts";
import { allSections } from "../src/config/workspace.config.mjs";

const rec = (o: any) => ({ id: "r1", section: "sales.pipeline", title: "Yacht Aurora", status: "Proposal", data: {}, ...o });

test("settings: defaults fill gaps and clamp numbers", () => {
  const s = withDefaults({ thresholds: { escalate_after: -5 }, agents: { brief: "off", rules: "weird" } });
  assert.equal(s.thresholds.escalate_after, 0);
  assert.equal(s.agents.brief, "off");
  assert.equal(s.agents.rules, DEFAULT_SETTINGS.agents.rules);
  assert.deepEqual(withDefaults(null), DEFAULT_SETTINGS);
});

test("calendar: weekends and holidays are days off", () => {
  const s = withDefaults({ company: { holidays: ["2026-11-26"] } });
  assert.equal(isWorkday("2026-10-14", s), true);  // Wednesday
  assert.equal(isWorkday("2026-10-17", s), false); // Saturday
  assert.equal(isWorkday("2026-11-26", s), false); // holiday
});

test("templates and conditions", () => {
  const r = rec({ data: { client: "Aurora Ltd", value: 2500000 } });
  assert.equal(render("Invoice — {title} for {client} ({data.value}) {nothing}", r), "Invoice — Yacht Aurora for Aurora Ltd (2500000)");
  assert.equal(render("{today}", r, "2026-10-14"), "2026-10-14");
  assert.ok(condOk(r, { field: "status", op: "in", value: "Proposal, Negotiation" }));
  assert.ok(condOk(r, { field: "owner", op: "empty" }));
  assert.ok(condOk(r, { field: "value", op: "gt", value: "1000000" }));
  assert.ok(!condOk(r, { field: "status", op: "nin", value: "proposal" }));
});

test("events: status rules fire only on a real change to the right status", () => {
  const won = DEFAULT_RULES.find((x) => x.id === "deal-won")!;
  assert.ok(matchEvent(won, rec({ status: "Won" }), { kind: "status", from: "Negotiation", to: "Won" }));
  assert.ok(!matchEvent(won, rec({ status: "Won" }), { kind: "status", from: "Won", to: "Won" }));
  assert.ok(!matchEvent(won, rec({ status: "Lost" }), { kind: "status", from: "Negotiation", to: "Lost" }));
  assert.ok(!matchEvent({ ...won, enabled: false }, rec({ status: "Won" }), { kind: "status", from: "Proposal", to: "Won" }));
  const hire = DEFAULT_RULES.find((x) => x.id === "hire-onboard")!;
  assert.ok(matchEvent(hire, rec({ section: "hr.team", status: "Onboarding" }), { kind: "created" }));
  assert.ok(!matchEvent(hire, rec({ section: "hr.team" }), { kind: "status", from: "Onboarding", to: "Active" }));
});

test("dates: fire on the day with a 3-day catch-up, respecting conditions", () => {
  const soon = DEFAULT_RULES.find((x) => x.id === "invoice-soon")!;
  const inv = rec({ section: "finance.invoices", status: "Sent", data: { due: "2026-10-20" } });
  assert.equal(dateDue(soon, inv, "2026-10-16"), null);
  assert.equal(dateDue(soon, inv, "2026-10-17"), "2026-10-17");
  assert.equal(dateDue(soon, inv, "2026-10-19"), "2026-10-17");
  assert.equal(dateDue(soon, inv, "2026-10-21"), null);
  assert.equal(dateDue(soon, { ...inv, status: "Paid" }, "2026-10-17"), null);
});

test("every ready-made rule points at real sections, statuses and fields", () => {
  const S = allSections() as any[];
  for (const r of DEFAULT_RULES as Rule[]) {
    const s = S.find((x) => x.id === r.section); assert.ok(s, r.section);
    if (r.status) assert.ok(s.statuses.includes(r.status), `${r.id} ${r.status}`);
    if (r.date_key) assert.ok(s.fields.some((f: any) => f.key === r.date_key), r.date_key);
    for (const a of r.actions) {
      if (a.type === "create") {
        const t = S.find((x) => x.id === a.section); assert.ok(t, a.section);
        if (a.status) assert.ok(t.statuses.includes(a.status), `${r.id} → ${a.status}`);
        for (const k of Object.keys(a.fields || {})) assert.ok(t.fields.some((f: any) => f.key === k), `${a.section}.${k}`);
        if (a.link) assert.ok(t.fields.some((f: any) => f.key === a.link && f.type === "ref"), a.link);
      }
      if (a.type === "set" && a.field === "status") assert.ok(s.statuses.includes(a.value));
    }
    assert.match(describe(r, (id) => id), /^When /);
  }
});

test("data quality finds gaps and offers safe fixes", () => {
  const S = allSections() as any[]; const now = Date.parse("2026-10-14");
  const fresh = "2026-10-10T00:00:00Z";
  const recs = [
    { id: "d1", section: "sales.pipeline", title: "Deal A", status: "Lead", data: { owner: "" }, updated_at: fresh },
    { id: "d2", section: "sales.pipeline", title: "deal a", status: "Lead", data: { owner: "Ann" }, updated_at: fresh },
    { id: "s1", section: "security.screening", title: "Party", status: "Pending", data: { owner: "Bob", deal_ref: "d2", deal_ref_title: "Old name" }, updated_at: fresh },
    { id: "s2", section: "security.screening", title: "Party 2", status: "Pending", data: { owner: "Bob", deal_ref: "gone" }, updated_at: "2026-01-01T00:00:00Z" },
    { id: "t1", section: "company.tasks", title: "Task", status: "Weird", data: { assignee: "Ann" }, updated_at: fresh },
  ];
  const iss = qualityIssues(recs as any, S, { staleDays: 60, now });
  const k = (id: string) => iss.filter((i) => i.id === id).map((i) => i.kind).sort();
  assert.deepEqual(k("d1"), ["no_owner"]);
  assert.ok(k("d2").includes("duplicate"));
  assert.deepEqual(iss.find((i) => i.id === "s1" && i.kind === "stale_link")?.fix, { deal_ref_title: "deal a" });
  assert.ok(k("s2").includes("broken_link") && k("s2").includes("stale"));
  assert.ok(k("t1").includes("bad_status"));
});

test("AI cost estimate", () => { assert.equal(aiCost(1_000_000, 100_000, DEFAULT_SETTINGS), 4.5); });
