// Playwright from the project, or from the global npm folder (it is not a dependency of the app).
import { execSync } from "node:child_process";
let mod;
try { mod = await import("playwright"); } catch { const g = execSync("npm root -g").toString().trim(); mod = await import(`${g}/playwright/index.mjs`).catch(() => import(`${g}/playwright/index.js`)); }
export const chromium = mod.chromium || mod.default.chromium;
