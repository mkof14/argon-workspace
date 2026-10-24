// node --test reporter (P9-R2): per-suite (per-file) counts of top-level tests, written as one JSON document.
// Used next to the normal TAP output: --test-reporter=tap --test-reporter-destination=stdout
//                                     --test-reporter=./scripts/acceptance/reporter.mjs --test-reporter-destination=<file>
import path from "node:path";
export default async function* reporter(source) {
  const suites = {}; const t0 = Date.now(); let tests = 0, passed = 0, failed = 0, skipped = 0, todo = 0, cancelled = 0;
  const key = (f) => (f ? path.basename(f).replace(/\.test\.ts$/, "") : "unknown");
  for await (const ev of source) {
    if ((ev.type !== "test:pass" && ev.type !== "test:fail") || ev.data.nesting !== 0 || ev.data.details?.type === "suite") continue;
    const s = (suites[key(ev.data.file)] ||= { tests: 0, passed: 0, failed: 0, skipped: 0 });
    s.tests++; tests++;
    if (ev.data.skip) { s.skipped++; skipped++; } else if (ev.data.todo) { todo++; } else if (ev.type === "test:pass") { s.passed++; passed++; }
    else { if (ev.data.details?.error?.failureType === "cancelledByParent") cancelled++; s.failed++; failed++; }
  }
  yield JSON.stringify({ tests, passed, failed, skipped, todo, cancelled, suites, suite_count: Object.keys(suites).length, duration_ms: Date.now() - t0 }, null, 1) + "\n";
}
