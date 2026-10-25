# FranchiseOS Neon Persistence Design

## Intent

Move FranchiseOS from browser-only localStorage to an optional shared persistence layer while preserving the existing static UI, scoring engine, importer, exports, and grounded bot behavior. The first milestone is local hosting against the new Neon `franchiseos` project; Vercel deployment remains a later manual step.

## Goals

- Persist workspaces, applications, territories, policy settings, audit events, and bot messages in Neon.
- Provide a small local HTTP API that the current browser app can use without exposing database credentials.
- Keep localStorage as a graceful offline fallback.
- Preserve existing behavior and pass the current test suite.
- Make the schema ready for later sector and market-analytics tables without implementing that larger feature now.

## Non-goals

- Authentication, multi-tenant permissions, or production security hardening.
- Gemini integration or web scraping.
- TAM/SAM/SOM, footfall, consumer-preference, or payback calculations.
- Vercel configuration or deployment.
- Replacing the existing scoring methodology.

## Approaches considered

1. Browser-only storage: no backend work, but cannot support shared workspaces or Neon.
2. Persistence-first API: a small Node server owns Neon access while the existing UI remains mostly unchanged. This is selected because it minimizes regression risk and creates the foundation for later analytics.
3. Full analytics platform now: persistence, market modeling, sector configuration, and Gemini in one change. This is deferred because it expands scope before shared data storage is validated.

## Design

- Add a Node HTTP server using the repository's existing JavaScript toolchain and the PostgreSQL driver.
- Read `DATABASE_URL` from the environment; never place credentials in browser code or committed files.
- Add SQL migrations/schema for `workspaces`, `applications`, `territories`, `workspace_settings`, `audit_events`, and `bot_messages`.
- Use a random workspace identifier stored in the browser; local mode remains available when the API is unavailable.
- Add API endpoints for workspace read and revision-checked workspace save. Audit events and bot messages remain in the same atomic snapshot and are mirrored to their own tables.
- Bind the API to `127.0.0.1` and reject non-local host/origin requests until authentication and shared access controls are implemented.
- Add a small client persistence adapter in the existing app. It attempts API persistence when configured, otherwise continues using localStorage.
- Keep imports and exports compatible with the existing JSON backup format.

## Verification

- Unit-test schema serialization and API handlers.
- Run the existing `npm test` suite.
- Run the local server with a Neon connection and exercise save/load using synthetic demo data.
- Confirm that failure of the API returns the app to localStorage mode without losing the current workspace.
- Confirm that stale revisions are rejected and local edits made during startup are not overwritten by an older server response.

## Open follow-up

Sector configuration and market analytics will use separate tables and a versioned calculation model after this persistence milestone is validated.
