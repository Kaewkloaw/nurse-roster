# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Thai-language nurse shift-roster web app (operating-room nursing units). It is a **single static file**, `public/index.html` (~1,500 lines of inline HTML/CSS/JS, no build step, no npm, no framework), served by Firebase Hosting and backed by Firestore + Firebase Auth. The UI text, comments and domain terms are Thai, and dates display in the Buddhist Era (year + 543).

There is no package.json, test suite or linter. Firebase SDK v10.12.2 is imported at runtime from `gstatic.com` as ES modules (`FB_VER` in index.html).

## Commands

- Run locally: `firebase serve --only hosting` or `firebase emulators:start`. Opening index.html via `file://` also works, but only in demo mode.
- Deploy everything: `firebase deploy`
- Deploy only rules: `firebase deploy --only firestore:rules`
- Deploy only hosting: `firebase deploy --only hosting`

## Demo mode vs. Firebase

`FIREBASE_CONFIG` near the top of the script holds placeholders (`"ใส่ค่า"`). While `apiKey` starts with `ใส่`, `DEMO` is true and the app uses `makeDemoBackend()`, an in-memory fake with the same interface as `makeFirebaseBackend()`, seeded by `seedDemo()`. Data is lost on reload. Any new persistence call must be added to **both** backends (the `B.*` interface: roles, units, months, leaves, plus `watch*` listeners).

## Data model (Firestore)

```
roles/{email}                      role: admin | head | nurse, unitId, staffId, canEditRules, name
units/{unitId}                     name, staff[], rules, shifts, paper, holidayOverrides
units/{unitId}/months/{YYYY-MM}    assign{}, log[]
units/{unitId}/leaves/{staffId}    dates{ 'YYYY-MM-DD': true }
```

- Assignment keys in `assign` are `"<iso>|<shift M/A/N>|<position>|<index>"`, with values like `{id, ot?, locked?}`. `keyValid()` drops keys that no longer match the rules.
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
- **Rendering:** hand-written string-template renderers (`renderSchedule`, `renderPeople`, `renderReport`, `renderSettings`, `renderUnits`, `renderUsers`) with `renderAll()` re-rendering the active unit. There is no virtual DOM.
- **Exports:** CSV plus PNG "paper form" exports drawn on `<canvas>` (`exportDaily`, `exportPeople`, `exportReport`), using the `PAPER` palette and the Sarabun font. The layouts imitate a specific hospital's paper roster.
- **Undo:** `pushUndo()` snapshots the roster state (60 deep), and `addLog()` appends to the per-month change log (max 100, not recorded for nurses).
