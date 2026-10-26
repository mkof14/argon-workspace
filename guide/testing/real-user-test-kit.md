# AGRON Workspace — Real-User Test Kit (gate P9.USERS)

Status: **NOT RUN — REAL HUMAN REQUIRED.** This kit prepares the test; it does not close the gate.
Synthetic personas, scripted browsers and Claude cannot satisfy this gate (the evidence engine rejects
`synthetic ≠ false` and any record not attested by the owner).

## 1. Setup (owner, once)

| Item | Requirement |
|---|---|
| Environment | **Staging only** (banner "STAGING" visible on every screen). Never production. |
| Participants | At least **3 real employees**, non-technical, who did not build the system. Ideally: one manager, one sales/operations person, one engineer or technician. |
| Accounts | One staging account per participant, created by the owner (public signup must be OFF first — owner action OA-SIGNUP). Role as in their real job. |
| Data | Synthetic staging data only. Participants must not paste real customer, export-controlled or personal data. |
| Facilitator | Michael or a delegate. Reads the task aloud, does **not** help, notes where the person hesitates. |
| Time | 45–60 minutes per participant. |
| Device | The participant's normal work computer (the device test is a separate kit). |

## 2. Rules for the facilitator

1. Say: "We are testing the system, not you. Think aloud."
2. Read each task exactly as written. Do not point to buttons.
3. If the person is stuck for 2 minutes, mark the task **Failed — stuck** and move on.
4. Record time per task (phone timer is enough).
5. Do not fix anything during the session; write it down.

## 3. Task set

| # | Task (read aloud) | Success = | Area |
|---|---|---|---|
| T1 | "Sign in." | Reaches the home screen | Sign-in |
| T2 | "Open My Day. Tell me the most important thing you should do now and why the system thinks so." | Names the top item and reads its reason | 1inow / My Day |
| T3 | "Find everything you are waiting on from other people." | Opens Waiting and names one item | 1inow |
| T4 | "Create a task for a colleague with a due date next Friday." | Task saved, assignee and date correct | Records |
| T5 | "Find the project called <synthetic project name>." | Opens it through global search | Search |
| T6 | "Attach a PDF to that project and open it again." | File visible and opens | Documents |
| T7 | "Write a comment that asks a colleague to answer by tomorrow." | Comment saved; appears as an open loop | Comments / Open loops |
| T8 | "Submit a purchase request for $3,000 and say who must approve it." | Request submitted; person names Department Lead | Workflow / policies |
| T9 | "Ask 1inow: what changed this week in my projects?" | Gets an answer that cites real records | Ask 1inow |
| T10 | "Ask 1inow to create a reminder for you. Then undo it." | Action shown for confirmation, executed only after "yes", undo works | Action safety |
| T11 | "Find the help article about approvals." | Opens the FAQ entry | Help |
| T12 | "Sign out." | Back on the sign-in page | Sign-out |

Role-specific add-ons (pick those that match the participant):

| # | Role | Task |
|---|---|---|
| R1 | Sales | "Log a follow-up call for an opportunity and set the next step date." |
| R2 | Manufacturing | "Find the build unit with serial <synthetic serial> and its open work orders." |
| R3 | Manager | "Open the executive view and name the project most at risk." |
| R4 | Engineering | "Open an engineering change request and say whether Management must approve it." |

## 4. Evidence form (one per participant)

```
Participant code: P__   (no names in the evidence store)   Role: ________   Date: ____   Facilitator: ____
Staging URL shown in address bar: ______________________   STAGING banner seen: Y / N
Build shown in the page footer (version · SHA · STAGING): ______________

Task | Result (Pass / Pass with help / Failed — stuck / Failed — error) | Time (min) | Notes (what confused them)
T1   |                                                                   |            |
…    |                                                                   |            |
T12  |                                                                   |            |

Overall: "Would you use this for your daily work?" 1–5: __   Biggest problem: ______________________
Errors seen on screen (copy the text exactly): ___________________________________________
```

## 5. Closing the gate (owner)

The gate passes only when **all** hold:
- ≥ 3 participants, each completed T1–T12;
- no task **Failed — error** (a system defect) left unfixed;
- every "Failed — stuck" has a recorded decision (fix, FAQ entry, or accepted);
- the owner attests the results.

Record (staging evidence store, owner-attested):

```json
{ "check_id": "P9.USERS", "environment": "staging", "status": "PASS", "recorded_via": "owner",
  "source_ref": "real-user session <date>",
  "metrics": { "synthetic": false, "participants": 3, "tasks_attempted": 36, "tasks_passed": 0,
               "failed_error": 0, "failed_stuck": 0, "release_sha": "<sha shown in About>" } }
```

Claude may prepare, fix defects found and re-run regression; Claude must not fill in this form.
