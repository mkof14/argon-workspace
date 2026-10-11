// HR checklists and rules used by the people pages, the HR overview and the morning digest.
export const ONBOARD_CHECKLIST = [
  "Offer letter signed and returned",
  "Confidentiality and invention assignment agreement signed",
  "Background check completed (with written authorization)",
  "US-person status confirmed, or export authorization assessed before access to controlled data",
  "Form I-9 section 1 on day 1, section 2 within 3 business days",
  "Payroll set up: W-4 and state withholding form, direct deposit",
  "Benefits enrollment pack sent",
  "Google Workspace account created",
  "AGRON Workspace invitation sent with the correct role",
  "Laptop and equipment issued and logged in “Company equipment issued”",
  "Password manager and two-factor authentication set up; device encrypted",
  "Export-control and sanctions briefing completed",
  "Information security and data protection rules acknowledged",
  "Code of conduct, anti-bribery and whistleblowing policies acknowledged",
  "Product introduction: StarDome configurations and AGRON 1",
  "30-60-90 day goals agreed with the manager",
  "Probation end date recorded in the people file",
];
export const OFFBOARD_CHECKLIST = [
  "Resignation or termination documented; HR and management informed",
  "Last working day confirmed and recorded",
  "Knowledge handover plan agreed; open tasks and records reassigned",
  "Access removed on the last day: Google Workspace, AGRON Workspace, GitHub, vendor portals, bank tokens",
  "Access to controlled technical data revoked and logged (Technology Control Plan)",
  "Shared passwords and API keys rotated",
  "Laptop, phone, badges and other equipment returned and logged",
  "Company data deleted from personal devices; written confirmation received",
  "Reminder of continuing confidentiality and invention assignment obligations given in writing",
  "Final pay calculated, including accrued paid time off where required by state law",
  "Benefits termination and COBRA notice sent (if applicable)",
  "Powers of attorney and signing authority revoked; banks and authorities notified",
  "Exit interview held and notes recorded",
  "People file status set to Left",
];
/** Working days (Mon–Fri) between two dates, inclusive. */
export function workingDays(from: string, to: string) {
  const a = new Date(from), b = new Date(to || from); if (isNaN(+a) || isNaN(+b) || b < a) return 0;
  let n = 0; for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
