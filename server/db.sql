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

-- Market intelligence is stored independently from franchise eligibility scores.
-- These tables are additive; existing workspace records are not migrated or rewritten.
CREATE TABLE IF NOT EXISTS market_source_versions (
  id text NOT NULL,
  version text NOT NULL,
  manifest jsonb NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS market_geographies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  external_id text,
  name text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (kind, external_id)
);

CREATE TABLE IF NOT EXISTS market_geo_relationships (
  parent_id uuid NOT NULL REFERENCES market_geographies(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES market_geographies(id) ON DELETE CASCADE,
  relationship text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (parent_id, child_id, relationship),
  CHECK (parent_id <> child_id)
);

CREATE TABLE IF NOT EXISTS market_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_key text NOT NULL UNIQUE,
  source_id text NOT NULL,
  source_version text NOT NULL,
  geography_id uuid REFERENCES market_geographies(id),
  metric text NOT NULL,
  value numeric,
  unit text NOT NULL,
  reference_period text,
  evidence_class text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_id, source_version) REFERENCES market_source_versions(id, version)
);

CREATE TABLE IF NOT EXISTS market_assessments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_assessments_workspace_updated_idx
  ON market_assessments (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS market_assessment_versions (
  assessment_id uuid NOT NULL REFERENCES market_assessments(id),
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, version)
);

CREATE TABLE IF NOT EXISTS market_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES market_assessments(id) ON DELETE CASCADE,
  name text,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_competitors_assessment_idx
  ON market_competitors (assessment_id);
