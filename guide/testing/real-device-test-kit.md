# AGRON Workspace — Real-Device Test Kit (gate P9.DEVICES)

Status: **NOT RUN — REAL DEVICE REQUIRED.** Required classes: **phone, tablet, desktop** (each needs ≥ 1
completed run with 0 failures). Browser viewport emulation is recorded separately as engineering evidence and is
**rejected** by the evidence engine for this gate.

## 1. Devices

| Class | Minimum device | Browser | Also check |
|---|---|---|---|
| phone | iPhone, iOS 17 or later | Safari | "Add to Home Screen" (installed app), portrait + landscape |
| tablet | iPad, iPadOS 17 or later | Safari | split view (half screen) |
| desktop | Mac or Windows laptop, 13"+ | Chrome **and** Safari or Edge | 100 % and 150 % zoom |

Record exact model and OS version (Settings → General → About).

## 2. Preconditions

- Staging only; "STAGING" banner visible. A staging test account (owner-created).
- Real network: one run on Wi-Fi, the phone run also once on cellular (4G/5G).
- MFA: if the account has MFA enrolled, sign in with the real authenticator (also counts toward the MFA checklist).

## 3. Checklist per device

| # | Check | Pass = |
|---|---|---|
| D1 | Open staging URL, sign in | Home screen, no zoom/scroll glitches, keyboard does not cover the button |
| D2 | My Day | Loads in < 3 s on Wi-Fi; lines readable without zoom; reasons visible |
| D3 | Navigation | Every section reachable; menu opens/closes; back button works |
| D4 | Global search | Results appear; tapping opens the record |
| D5 | Create a task | Form usable with on-screen keyboard; date picker works; saved |
| D6 | Upload a file | Phone: from Photos and Files; desktop: drag-and-drop; file opens afterwards |
| D7 | Open a PDF | Viewer opens; can return to the app |
| D8 | Voice capture (phone/tablet) | Microphone permission prompt appears; dictated text lands in Inbox |
| D9 | Ask 1inow | Answer appears; an action asks for confirmation before executing |
| D10 | Rotate (phone/tablet) | Layout re-flows, no cut-off content |
| D11 | Arabic language | Right-to-left layout correct; switch back to English |
| D12 | Lock screen 5 min, return | Session still valid or clean sign-in prompt; no data lost in an open form draft |
| D13 | Installed app (phone) | Home-screen icon opens full-screen app; sign-in persists |
| D14 | Offline | Airplane mode → clear "offline" message, no crash; back online → recovers |
| D15 | Sign out | Returns to sign-in; back button does not show private data |

## 4. Evidence form (one per device)

```
Device class: phone / tablet / desktop   Model: ________   OS: ________   Browser + version: ________
Network: Wi-Fi / cellular   Tester code: T__   Date: ____   Build in the page footer: ________
Check | Pass / Fail | Notes (screenshot file name if Fail)
D1 … D15
```

## 5. Closing the gate (owner)

```json
{ "check_id": "P9.DEVICES", "environment": "staging", "status": "PASS", "recorded_via": "owner",
  "source_ref": "real-device session <date>",
  "metrics": { "mode": "real_device", "release_sha": "<sha>",
    "devices": [
      { "class": "phone",   "model": "iPhone …", "os": "iOS …",     "browser": "Safari", "completed": 15, "failed": 0 },
      { "class": "tablet",  "model": "iPad …",   "os": "iPadOS …",  "browser": "Safari", "completed": 15, "failed": 0 },
      { "class": "desktop", "model": "…",        "os": "macOS …",   "browser": "Chrome", "completed": 15, "failed": 0 } ] } }
```

Any "Fail" → Claude fixes, full regression re-runs at the new SHA, and the affected device checks are repeated.
