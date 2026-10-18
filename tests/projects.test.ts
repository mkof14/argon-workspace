import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_TEMPLATES, projectPlan } from "../src/lib/projects.ts";

test("a won deal becomes a dated plan linked to the deal, with owners per role", () => {
  const deal = { id: "d1", title: "Skyline", status: "Won", data: { client: "Skyline Marina", config: "C40 Advanced", country: "UAE", currency: "USD" } };
  const plan = projectPlan(deal, PROJECT_TEMPLATES[1], "2026-11-02", "ru", { operations: "Anna", sales: "Ivan" });
  assert.equal(plan.length, 11);
  const build = plan.find((p) => p.key === "build")!;
  assert.equal(build.section, "operations.builds"); assert.equal(build.data.deal_ref, "d1"); assert.equal(build.data.assembly, "UAE"); assert.equal(build.data.owner, "Anna");
  assert.equal(build.title, "StarDome C40 Advanced для Skyline Marina");
  const ship = plan.find((p) => p.key === "ship")!; assert.equal(ship.due, "2027-01-25"); assert.equal(ship.link, "build"); assert.equal(ship.data.due, "2027-01-25");
  const kick = plan.find((p) => p.key === "kickoff")!; assert.equal(kick.data.assignee, "Ivan"); assert.equal(kick.data.related, "/sales/pipeline?r=d1");
  assert.ok(plan.every((p) => p.data.project === "d1"));
  assert.equal(plan.find((p) => p.key === "screen")!.data.party, "Skyline Marina");
});
