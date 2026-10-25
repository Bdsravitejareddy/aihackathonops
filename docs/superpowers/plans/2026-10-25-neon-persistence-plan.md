# FranchiseOS Neon Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional Neon-backed persistence to the existing FranchiseOS static app while preserving localStorage fallback and current behavior.

**Architecture:** A small Node HTTP server owns Neon access and exposes workspace persistence endpoints. The browser app uses an adapter that prefers the API when configured and falls back to localStorage when unavailable.

**Tech Stack:** Node.js, built-in `node:http`, Neon serverless PostgreSQL driver, existing browser JavaScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-25-neon-persistence-design.md`

## Global Constraints

- Database credentials stay server-side in `DATABASE_URL` and are never committed.
- Existing localStorage behavior remains available when the API is unavailable.
- Existing scoring, importer, bot, export formats, and UI behavior remain compatible.
- Vercel deployment is out of scope for this milestone.

## Review Focus

- Malformed or oversized workspace payloads are rejected without replacing stored data — test API validation.
- A missing or unreachable database falls back to localStorage — test client persistence adapter.
- Re-saving a workspace replaces its current snapshot without duplicating child rows — test persistence round trip.
- Anonymous workspace identifiers cannot read another workspace accidentally — test workspace scoping.
- Browser credentials never appear in frontend source or API responses — test configuration boundaries.

### Task 1: Server and schema foundation

**Files:**
- Create: `server/db.sql`
- Create: `server/validation.js`
- Create: `server/app.js`
- Modify: `package.json`
- Test: `tests/server.test.cjs`

**Interfaces:**
- `createServer({ query, maxBodyBytes }) -> http.Server`
- `validateWorkspacePayload(value) -> { ok: boolean, error?: string }`
- `GET /api/health -> { ok: true }`
- `GET /api/workspaces/:id -> workspace snapshot or 404`
- `PUT /api/workspaces/:id -> { ok: true }`

- [x] Write failing tests for health, missing workspace, valid save/load round trip, malformed payload rejection, and workspace isolation.
- [x] Run `node --test tests/server.test.cjs` and verify the new tests fail because the server does not exist.
- [x] Implement schema, validation, and the minimal HTTP server with an injectable query function for tests.
- [x] Add the Neon driver dependency and `npm run start` script without committing credentials.
- [x] Run the server tests and the existing `npm test` suite.

### Task 2: Browser persistence adapter

**Files:**
- Create: `dist/persistence.js`
- Modify: `dist/index.html`
- Modify: `dist/app.js`
- Test: `tests/persistence.test.cjs`

**Interfaces:**
- `createPersistence({ fetchImpl, storage, baseUrl }) -> { load, save, mode }`
- `load(workspaceId) -> Promise<state|null>`
- `save(workspaceId, state) -> Promise<void>`

- [x] Write failing tests for API-preferred load/save and API failure fallback.
- [x] Run the focused tests and verify failure for the missing adapter.
- [x] Implement the adapter and load the existing workspace through it without changing the backup format.
- [x] Wire save points to persist asynchronously while retaining immediate localStorage writes.
- [x] Update the status badge to distinguish Neon sync from browser-only mode.
- [x] Run focused tests and the existing suite.

### Task 3: Local hosting and Neon integration verification

**Files:**
- Create: `.env.example`
- Create: `scripts/init-neon.cjs`
- Modify: `README.md`
- Modify: `.gitignore`

- [x] Add documented environment variables and a safe local startup command.
- [x] Apply the schema to the new Neon project using the connected Neon integration.
- [x] Start the local server with the real `DATABASE_URL` and serve `dist/` from it.
- [ ] Load synthetic demo data in a browser, save it, reload the browser, and confirm the workspace survives. (Browser automation surface is unavailable in this session.)
- [x] Run all automated tests and record the verification result in `docs/progress.md`.

### Task 4: GitHub write-back

**Files:**
- All files from Tasks 1–3.

- [ ] Review the diff for secrets, generated files, and accidental unrelated changes.
- [ ] Commit with `feat: add optional Neon workspace persistence`.
- [ ] Push the commit to `Bdsravitejareddy/aihackathonops` only after verification passes.
