import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_TEMPLATES, projectPlan } from "../src/lib/projects.ts";

test("a won deal becomes a dated plan linked to the deal, with owners per role", () => {
  const deal = { id: "d1", title: "Skyline", status: "Won", data: { client: "Skyline Marina", config: "C40 Advanced", country: "UAE", currency: "USD" } };
  const plan = projectPlan(deal, PROJECT_TEMPLATES[1], "2026-11-02", "ru", { operations: "Anna", sales: "Ivan" });
  assert.equal(plan.length, 10);
  const build = plan.find((p) => p.key === "build")!;
  assert.equal(build.section, "operations.builds"); assert.equal(build.data.deal_ref, "d1"); assert.equal(build.data.assembly, "UAE"); assert.equal(build.data.owner, "Anna");
  assert.equal(build.title, "StarDome C40 Advanced для Skyline Marina");
  const ship = plan.find((p) => p.key === "ship")!; assert.equal(ship.due, "2027-01-25"); assert.equal(ship.link, "build"); assert.equal(ship.data.due, "2027-01-25");
  const kick = plan.find((p) => p.key === "kickoff")!; assert.equal(kick.data.assignee, "Ivan"); assert.equal(kick.data.related, "/sales/pipeline?r=d1");
  assert.ok(plan.every((p) => p.data.project === "d1"));
  assert.equal(plan.find((p) => p.key === "screen")!.data.party, "Skyline Marina");
});

import { shiftPlan, stepDate } from "../src/lib/projects.ts";
test("moving a step moves the later unfinished steps by the same days", () => {
  const recs: any[] = [
    { id: "a", section: "security.screening", status: "Cleared", data: { project_step: "screen", date: "2026-11-01" } },
    { id: "b", section: "operations.builds", status: "Assembly", data: { project_step: "build", due: "2026-12-01" } },
    { id: "c", section: "operations.logistics", status: "Planned", data: { project_step: "ship", due: "2027-01-10" } },
    { id: "d", section: "operations.quality", status: "Passed", data: { project_step: "sat", date: "2027-02-01" } },
    { id: "e", section: "company.tasks", status: "Open", data: { project_step: "training", due: "2027-02-05" } },
  ];
  assert.equal(stepDate(recs[2]), "2027-01-10");
  const ch = shiftPlan(recs, "b", "2026-12-15");
  assert.deepEqual(ch.map((c) => [c.id, c.key, c.to]), [["b", "due", "2026-12-15"], ["c", "due", "2027-01-24"], ["e", "due", "2027-02-19"]]);
  assert.equal(shiftPlan(recs, "b", "2026-12-01").length, 0);
});

test("every project template is defined (no holes in the list)", async () => {
  const { PROJECT_TEMPLATES, stepDateKey } = await import("../src/lib/projects.ts");
  assert.equal(PROJECT_TEMPLATES.length, 3); assert.ok(PROJECT_TEMPLATES.every((t) => t && t.steps.length >= 10));
  assert.equal(stepDateKey({ section: "operations.quality", data: { project_step: "fat" } }), "date");
});
