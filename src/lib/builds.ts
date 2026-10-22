// The build unit lifecycle (Phase 8, v25) and the earlier container-build statuses, side by side: the screens,
// agents and the client portal read builds through these helpers, so a record on either list means the same.
export const BUILD_LIFECYCLE = ["Planned", "Engineering", "Material Planning", "Procurement", "Ready for Build", "Assembly", "Integration", "Inspection", "Testing", "Rework", "Acceptance", "Ready for Shipment", "Shipped", "Delivered", "Hold", "Cancelled"];
/** Earlier status → lifecycle status (what v25 moved the data to). */
export const LEGACY_BUILD: Record<string, string> = { Design: "Engineering", Procurement: "Procurement", Assembly: "Assembly", Integration: "Integration", Testing: "Testing", Shipping: "Shipped", Installed: "Delivered" };
export const buildStatus = (s?: string | null) => (s ? LEGACY_BUILD[s] || s : "");
/** Finished: delivered (installed) or cancelled — no longer "in progress". */
export const buildClosed = (s?: string | null) => ["Delivered", "Cancelled"].includes(buildStatus(s));
/** The goods leave (or have left): the export and end-user checks apply. */
export const SHIP_STATUSES = ["Ready for Shipment", "Shipped", "Delivered", "Shipping", "Installed"];
export const buildShipping = (s?: string | null) => ["Ready for Shipment", "Shipped"].includes(buildStatus(s));
export const buildDelivered = (s?: string | null) => buildStatus(s) === "Delivered";
/** Still before the build starts (parts and procurement matter most). */
export const buildEarly = (s?: string | null) => ["Planned", "Engineering", "Material Planning", "Procurement", "Ready for Build", "Assembly"].includes(buildStatus(s));
export const buildTesting = (s?: string | null) => ["Integration", "Inspection", "Testing", "Rework", "Acceptance"].includes(buildStatus(s));
/** The seven phases the client portal shows (the lifecycle is internal detail). */
export const PORTAL_PHASES = ["Design", "Procurement", "Assembly", "Integration", "Testing", "Shipping", "Installed"];
const PHASE: Record<string, number> = { Planned: 0, Engineering: 0, "Material Planning": 1, Procurement: 1, "Ready for Build": 1, Assembly: 2, Integration: 3, Inspection: 4, Testing: 4, Rework: 4, Acceptance: 4,
  "Ready for Shipment": 5, Shipped: 5, Delivered: 6 };
export const portalPhase = (s?: string | null) => { const v = PHASE[buildStatus(s)]; return v === undefined ? 0 : v; };
