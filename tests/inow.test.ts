// P10 — 1inow deterministic engine (src/lib/inow.ts) and the time-zone helper of the server half.
// Every rule that decides what a person sees first is tested here: priority, reasons, sections, personal state,
// controlled items that can never be hidden, de-duplication, Required vs Suggested next step, Ask intents, capture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMyDay, priorityOf, rankItem, compare, applyState, dedupe, suggestionsFor, why, explain, askIntent, classifyCapture, SIGNAL_TEXT, type Item, type State } from "../src/lib/inow.ts";
import { zonedToUtc, localToday } from "../src/lib/server/inow.ts";

const NOW = Date.parse("2026-10-25T14:00:00Z"); const TODAY = "2026-10-25";
const it = (key: string, o: Partial<Item> = {}): Item => ({ key, src: "task", kind: "task", title: key, link: `/company/tasks?r=${key}`, record_id: key, signals: [{ code: "assigned_to_me" }], ...o });

test("priority: HIGH thresholds are rules, not scores", () => {
  assert.equal(priorityOf([{ code: "meeting_soon", n: 30 }]), "HIGH");
  assert.equal(priorityOf([{ code: "meeting_soon", n: 90 }]), "LOW");
  assert.equal(priorityOf([{ code: "overdue", n: 2 }]), "HIGH");
  assert.equal(priorityOf([{ code: "approval_waiting", n: 30 }]), "HIGH");
  assert.equal(priorityOf([{ code: "approval_waiting", n: 3 }]), "MEDIUM");
  assert.equal(priorityOf([{ code: "customer_waiting", n: 3 }]), "HIGH");
  assert.equal(priorityOf([{ code: "customer_waiting", n: 1 }]), "LOW");
  assert.equal(priorityOf([{ code: "blocks_others" }]), "HIGH");
  assert.equal(priorityOf([{ code: "due_today" }]), "MEDIUM");
  assert.equal(priorityOf([{ code: "due_today" }, { code: "priority_high" }]), "HIGH");
  assert.equal(priorityOf([{ code: "due_today" }, { code: "external_commitment" }]), "HIGH");
  assert.equal(priorityOf([{ code: "assigned_to_me" }]), "LOW");
  assert.equal(priorityOf([]), "LOW");
});

test("reasons are explained in every language and ordered by strength", () => {
  const r = rankItem(it("a", { signals: [{ code: "assigned_to_me" }, { code: "due_today" }, { code: "blocks_others", text: "C20 assembly" }] }));
  assert.equal(r.priority, "HIGH");
  assert.equal(r.reasons[0].code, "blocks_others");
  assert.equal(r.reasons.at(-1)!.code, "assigned_to_me");
  for (const l of ["en", "ru", "uk", "ar"] as const) { const w = why(r, l); assert.ok(w.length > 10, l); assert.ok(!w.includes("{n}") && !w.includes("{text}"), l); }
  assert.match(why(r, "en"), /^HIGH because: /);
  for (const code of Object.keys(SIGNAL_TEXT) as any[]) for (const l of ["en", "ru", "uk", "ar"] as const) assert.ok(explain({ code, n: 3, text: "X" }, l).length > 0, `${code}/${l}`);
});

test("deterministic order: same input → same output regardless of input order", () => {
  const items = [it("b", { signals: [{ code: "due_today" }] }), it("a", { signals: [{ code: "overdue", n: 1 }] }), it("c", { signals: [{ code: "due_soon" }] }), it("d", { signals: [{ code: "overdue", n: 1 }] })];
  const one = buildMyDay(items, [], { now: NOW, today: TODAY });
  const two = buildMyDay([...items].reverse(), [], { now: NOW, today: TODAY });
  assert.deepEqual(JSON.stringify(one), JSON.stringify(two));
  assert.deepEqual(one.now.map((r) => r.key), ["a", "d"]);
  const ranked = items.map((x) => rankItem(x)).sort(compare);
  assert.deepEqual(ranked.map((r) => r.key), ["a", "d", "b", "c"]);
});

test("each item appears in exactly one section; NOW is capped", () => {
  const items = Array.from({ length: 9 }, (_, i) => it(`h${i}`, { signals: [{ code: "overdue", n: i + 1 }] }))
    .concat([it("w", { src: "waiting", signals: [{ code: "vendor_waiting", n: 4 }] }), it("l", { src: "loop", signals: [{ code: "unanswered" }] }), it("ap", { src: "approval", controlled: true, signals: [{ code: "approval_waiting", n: 2 }] }), it("m", { src: "meeting", due: TODAY, signals: [{ code: "meeting_today" }] })]);
  const d = buildMyDay(items, [], { now: NOW, today: TODAY });
  assert.equal(d.now.length, 5);
  const keys = [...d.now, ...d.today, ...d.attention, ...d.waiting, ...d.decisions, ...d.loops].map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicates across sections");
  assert.equal(keys.length, items.length, "nothing silently dropped");
  assert.ok(d.waiting.some((r) => r.key === "w")); assert.ok(d.loops.some((r) => r.key === "l")); assert.ok(d.decisions.some((r) => r.key === "ap")); assert.ok(d.today.some((r) => r.key === "m"));
  assert.equal(d.counts.now, 5);
});

test("personal state: snooze, dismiss, not relevant hide ordinary items; a due reminder brings it back", () => {
  const items = [it("s"), it("d"), it("n"), it("r"), it("future")];
  const st: State[] = [
    { item_key: "s", snooze_until: new Date(NOW + 36e5).toISOString() }, { item_key: "d", dismissed_at: new Date(NOW - 1).toISOString() },
    { item_key: "n", not_relevant: true }, { item_key: "r", snooze_until: new Date(NOW + 864e5).toISOString(), remind_at: new Date(NOW - 60e3).toISOString() },
    { item_key: "future", snooze_until: new Date(NOW - 1000).toISOString() },
  ];
  const { visible, hidden } = applyState(items, st, NOW);
  assert.equal(hidden, 3);
  assert.deepEqual(visible.map((v) => v.it.key).sort(), ["future", "r"]);
  const r = visible.find((v) => v.it.key === "r")!; assert.ok(r.it.signals.some((s) => s.code === "reminder_due"));
  const d = buildMyDay(items, st, { now: NOW, today: TODAY }); assert.ok(d.now.some((x) => x.key === "r"), "a due reminder is HIGH");
});

test("controlled items (approvals, workflow steps) can never be hidden by personal preference", () => {
  const items = [it("ap", { src: "approval", controlled: true, signals: [{ code: "approval_waiting", n: 1 }] }), it("wf", { src: "workflow", controlled: true, signals: [{ code: "sla_overdue" }] })];
  const st: State[] = [{ item_key: "ap", dismissed_at: new Date(NOW).toISOString(), not_relevant: true, snooze_until: new Date(NOW + 864e5).toISOString() }, { item_key: "wf", not_relevant: true }];
  const d = buildMyDay(items, st, { now: NOW, today: TODAY });
  assert.equal(d.hidden, 0);
  const all = [...d.now, ...d.decisions, ...d.today]; assert.ok(all.some((r) => r.key === "ap")); assert.ok(all.some((r) => r.key === "wf"));
  for (const r of all) { assert.ok(!r.suggested.some((s) => s.kind === "snooze" || s.kind === "dismiss"), "no hide action offered"); assert.ok(r.suggested.some((s) => s.id === "decide" && s.controlled)); }
});

test("pinned items rise to NOW even when LOW", () => {
  const d = buildMyDay([it("low"), it("hi", { signals: [{ code: "overdue", n: 1 }] })], [{ item_key: "low", pinned: true }], { now: NOW, today: TODAY });
  assert.deepEqual(d.now.map((r) => r.key), ["low", "hi"]);
  assert.ok(d.now[0].reasons.some((s) => s.code === "pinned"));
});

test("dedupe: the same record from several engines is one item with the union of signals and the strongest source", () => {
  const a = it("task:1", { record_id: "1", signals: [{ code: "due_today" }] });
  const b = it("attention:1", { src: "attention", record_id: "1", signals: [{ code: "blocks_others" }] });
  const c = it("approval:1", { src: "approval", record_id: "1", controlled: true, required_next: "Approve or reject: X", signals: [{ code: "approval_waiting", n: 2 }] });
  const out = dedupe([a, b, c]);
  assert.equal(out.length, 1); assert.equal(out[0].src, "approval"); assert.equal(out[0].controlled, true); assert.equal(out[0].required_next, "Approve or reject: X");
  assert.deepEqual(out[0].signals.map((s) => s.code).sort(), ["approval_waiting", "blocks_others", "due_today"]);
  const noRec = dedupe([it("x", { record_id: null }), it("y", { record_id: null })]); assert.equal(noRec.length, 2);
});

test("NEXT: Required next step and Suggested next action are never mixed", () => {
  const d = buildMyDay([it("ap", { src: "approval", controlled: true, required_next: "Approve or reject: PO-12", signals: [{ code: "approval_waiting", n: 30 }] }), it("t", { signals: [{ code: "overdue", n: 1 }] })], [], { now: NOW, today: TODAY });
  const ap = d.next.find((n) => n.item.key === "ap")!; assert.equal(ap.required, "Approve or reject: PO-12"); assert.equal(ap.suggested.length, 0);
  const t = d.next.find((n) => n.item.key === "t")!; assert.equal(t.required, null); assert.ok(t.suggested.length > 0);
  assert.ok(t.suggested.every((s) => !["open", "pin", "snooze", "dismiss"].includes(s.kind)));
});

test("suggested actions are context-sensitive", () => {
  const ids = (x: Item) => suggestionsFor(x).map((s) => s.kind);
  assert.ok(ids(it("t", { signals: [{ code: "overdue", n: 1 }] })).includes("reschedule"));
  assert.ok(ids(it("w", { src: "waiting", signals: [{ code: "vendor_waiting", n: 5 }] })).includes("followup_task"));
  assert.ok(ids(it("m", { src: "meeting", signals: [{ code: "meeting_soon", n: 20 }] })).includes("brief"));
  assert.ok(ids(it("u", { src: "unit", signals: [{ code: "build_blocked" }] })).includes("blockers"));
  assert.ok(ids(it("c", { src: "commitment", signals: [{ code: "promised" }] })).includes("confirm_commitment"));
  assert.ok(!ids(it("m2", { src: "meeting", signals: [] })).includes("complete"), "a meeting is not 'completed' from here");
});

test("Ask 1inow intents (EN/RU/UK) and subjects", () => {
  const c = (q: string) => askIntent(q);
  assert.equal(c("What needs my attention?").intent, "attention");
  assert.equal(c("Что требует моего внимания?").intent, "attention");
  assert.equal(c("Що потребує моєї уваги?").intent, "attention");
  assert.deepEqual(c("What is blocking C20?"), { intent: "blockers", subject: "c20" });
  assert.equal(c("What is happening with IDEX?").intent, "project");
  assert.equal(c("What is waiting for me?").intent, "waiting_me");
  assert.equal(c("Who are we waiting for?").intent, "waiting_others");
  assert.equal(c("What changed this week?").intent, "changes");
  assert.equal(c("Which projects are stalled?").intent, "stalled");
  assert.equal(c("Which approvals are waiting?").intent, "approvals");
  assert.equal(c("Which proposals have no response?").intent, "proposals_no_response");
  assert.equal(c("Which vendors are late?").intent, "vendors_late");
  assert.equal(c("What did I promise?").intent, "promises");
  assert.equal(c("What should I do next?").intent, "next");
  assert.equal(c("Что изменилось?").intent, "changes");
  assert.equal(c("Write me a poem about rockets").intent, "unknown");
});

test("quick capture classification (deterministic; unclear text stays unresolved, never guessed)", () => {
  assert.deepEqual(classifyCapture("Call John tomorrow about IDEX pricing"), { kind: "call", person: "John", context: "IDEX pricing", confidence: "high" });
  assert.equal(classifyCapture("Remind me to check the Platinum documents").kind, "reminder");
  assert.equal(classifyCapture("Позвонить Максу по поводу котировки").kind, "call");
  assert.equal(classifyCapture("Позвонить Максу по поводу котировки").person, "Максу");
  assert.equal(classifyCapture("Напомни проверить договор").kind, "reminder");
  assert.equal(classifyCapture("Нагадай перевірити договір").kind, "reminder");
  assert.equal(classifyCapture("Need to update the BOM").kind, "task");
  assert.equal(classifyCapture("Review the vendor quote").kind, "review");
  const u = classifyCapture("blue sky"); assert.equal(u.kind, "unresolved"); assert.equal(u.confidence, "low");
});

test("time zones: a meeting at 09:00 New York is 13:00/14:00 UTC (DST aware); local today", () => {
  assert.equal(new Date(zonedToUtc("2026-07-01", "09:00", "America/New_York")!).toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-12-01", "09:00", "America/New_York")!).toISOString(), "2026-12-01T14:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-12-01", "09:00", "Asia/Dubai")!).toISOString(), "2026-12-01T05:00:00.000Z");
  assert.equal(new Date(zonedToUtc("2026-12-01", "09:00", null)!).toISOString(), "2026-12-01T09:00:00.000Z");
  assert.equal(zonedToUtc("bad", "09:00", "UTC"), null);
  assert.equal(localToday("Asia/Tokyo", new Date("2026-10-25T20:00:00Z")), "2026-10-26");
  assert.equal(localToday("America/Los_Angeles", new Date("2026-10-25T05:00:00Z")), "2026-10-24");
});
