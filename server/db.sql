CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  state jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE TABLE IF NOT EXISTS applications (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position integer NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (workspace_id, position)
);

CREATE TABLE IF NOT EXISTS territories (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position integer NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (workspace_id, position)
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  settings jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position integer NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (workspace_id, position)
);

CREATE TABLE IF NOT EXISTS bot_messages (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position integer NOT NULL,
  message jsonb NOT NULL,
  PRIMARY KEY (workspace_id, position)
);
