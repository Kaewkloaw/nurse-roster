# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Thai-language nurse shift-roster web app (operating-room nursing units). It is a static site with no build step, no npm and no framework: `public/index.html` (markup), `public/style.css`, and classic (non-module) scripts in `public/js/` loaded in order — `config.js`, `state.js` (constants, global state, date helpers), `rules-engine.js` (slots, rules, rotation, `autoFill`), `preset-2570.js` (2570 staff/rotation preset), `backend.js`, `export.js`, `app.js` (session, load/save, all UI). All top-level names are shared globals across these files. It is served by Firebase Hosting and backed by Firestore + Firebase Auth. The UI text, comments and domain terms are Thai, and dates display in the Buddhist Era (year + 543).

There is no package.json, test suite or linter. Firebase SDK v10.12.2 is imported at runtime from `gstatic.com` as ES modules (`FB_VER` in index.html).

## Commands

- Run locally: `firebase serve --only hosting` or `firebase emulators:start`. Opening index.html via `file://` also works, but only in demo mode.
- Deploy everything: `firebase deploy`
- Deploy only rules: `firebase deploy --only firestore:rules`
- Deploy only hosting: `firebase deploy --only hosting`

## Demo mode vs. Firebase

`FIREBASE_CONFIG` near the top of the script is configured for the `nurseroster-df4d8` Firebase project. If `apiKey` is empty or starts with `ใส่`, `DEMO` is true and the app uses `makeDemoBackend()`, an in-memory fake with the same interface as `makeFirebaseBackend()`, seeded by `seedDemo()`. Data is lost on reload. Any new persistence call must be added to **both** backends (the `B.*` interface: roles, units, months, leaves, plus `watch*` listeners).

## Data model (Firestore)

```
roles/{email}                      role: admin | head | nurse, unitId, staffId, canEditRules, name
units/{unitId}                     name, staff[], rules, shifts, paper, holidayOverrides
units/{unitId}/months/{YYYY-MM}    assign{}, log[], rotQueue?
units/{unitId}/leaves/{staffId}    dates{ 'YYYY-MM-DD': true }
```

- Assignment keys in `assign` are `"<iso>|<shift M/A/N>|<position>|<index>"`, with values like `{id, ot?, locked?}`. The current two-shift UI uses M/A. Legacy N assignments are kept separately in `legacyAssign` and written back unchanged so normal edits do not destroy historical night-shift data. `keyValid()` drops visible keys that no longer match the rules.
- A user's role comes from `roles/{lowercased email}`, and a signed-in user without a role doc cannot do anything.

## Permissions are enforced in two places that must stay in sync

1. `firestore.rules` is the real authority:
   - admin can do everything.
   - head can edit their own unit and its months. They can change `rules`/`shifts` only if `canEditRules` is true, and can never change `name`.
   - nurse can read the unit and months, and can read/write only their own `leaves/{staffId}`.
2. Client helpers (`isAdmin()`, `isNurse()`, `canEditRules()`, `applyRoleUI()`) hide or disable UI to match.

When changing a permission, update both. Note `unitPayload()` writes `rawLocked.name`/`rawLocked.rules`/`rawLocked.shifts` back unchanged for users who cannot edit them, because a rules-denied field in the payload would fail the whole `setDoc`.

## Architecture of index.html

Everything shares one global `state` object (current unit and month, staff, rules, assignments, unavailability) plus module-level `let`s (`B` backend, `session`, `unitId`, `undoStack`, save bookkeeping).

- **Persistence flow:** UI edits call `markDirty()`, which debounces 700 ms into `saveNow()`. `saveNow` diffs JSON snapshots (`lastUnitJson`, `lastMonthJson`, `lastLeave`) and writes only what changed. Nurses write only leaves.
- **Realtime sync:** `watchCurrent()` subscribes to the unit, month and leaves. Snapshots are ignored while a local save is pending or in flight, and when `updatedAt` matches the last local write (echo suppression). This avoids clobbering local edits, so keep that guard when adding listeners.
- **Months loaded:** `loadMonths()` loads previous, current and next month, because the scheduling rules look across month boundaries.
- **Rules engine:** `problems()`, `slotIssues()` and `unitProblems()` validate a slot against `state.rules` (evening followed by next morning, holiday consistency, same-day double shifts, consecutive shifts, per-month caps). They work from the `buildIndex()` per-person index. `autoFill(mode)` is the greedy/variance-balancing auto-scheduler. Holidays come from `FIXED_HOL` plus `holidayOverrides`, and "off days" (weekends and holidays) use `offShifts`/`needOff` instead of `weekdayShifts`/`need`.
- **Rotation queues:** `rules.rotation = {on, start, otrn[], otpn[], hol:{senior,junior,pn}}` (staff ids in queue order). When on, `autoFill` fills holiday-queue senior/junior/pn slots and then OT slots from the queues *before* the greedy pass, via `applyRotation()`, so the OT order stays strict and the greedy pass avoids each day's OT person. A person who is next but has a problem that day is skipped and stays at the head of the queue; slots already filled (locked/manual) count as that person's turn. Assignments made this way carry `rot:true`. `monthPayload()` stores the end-of-month queue (`rotEndQueues()`, recomputed from actual assignments) as `rotQueue`, and the next month starts from the previous month's `rotQueue` (`rotPrevQueue`, set in `applyMonth`). Rescheduling a month makes the following month's queue stale until it is rescheduled. Holiday-queue days come from `isHolQueueDay()`: any run of off days that contains a public holiday, plus a single working day that bridges it to the next off-day run (and that run).
- **Conflict rules:** `rules.conflicts = [{a:[ids], aSlot, b:[ids], bSlot, scope:'day'|'shift', note}]` (`aSlot`/`bSlot` are a `SLOTS` key or `'any'`). `problems()` flags both sides when a group-a person in `aSlot` shares the day (or shift) with a group-b person in `bSlot`, so auto-fill avoids it and manual edits show a warning.
- **Rendering:** hand-written string-template renderers (`renderSchedule`, `renderPeople`, `renderReport`, `renderSettings`, `renderUnits`, `renderUsers`) with `renderAll()` re-rendering the active unit. There is no virtual DOM.
- **Exports:** CSV plus PNG "paper form" exports drawn on `<canvas>` (`exportDaily`, `exportPeople`, `exportReport`), using the `PAPER` palette and the Sarabun font. The layouts imitate a specific hospital's paper roster.
- **Undo:** `pushUndo()` snapshots the roster state (60 deep), and `addLog()` appends to the per-month change log (max 100, not recorded for nurses).
