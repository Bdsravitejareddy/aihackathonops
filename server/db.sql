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
CREATE EXTENSION IF NOT EXISTS postgis;
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
  geom geometry(Geometry, 4326),
  UNIQUE (kind, external_id)
);

ALTER TABLE market_geographies ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 4326);
CREATE INDEX IF NOT EXISTS market_geographies_geom_gix ON market_geographies USING GIST (geom);
CREATE INDEX IF NOT EXISTS market_geographies_kind_name_idx ON market_geographies (kind, name);

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

CREATE INDEX IF NOT EXISTS market_observations_geography_metric_idx
  ON market_observations (geography_id, metric, reference_period);

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

-- Grounded Gemini research is versioned separately from deterministic market figures.
CREATE TABLE IF NOT EXISTS market_research_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geography_id uuid NOT NULL REFERENCES market_geographies(id) ON DELETE CASCADE,
  geography_external_id text NOT NULL,
  apparel_segment text NOT NULL,
  assessment_id uuid REFERENCES market_assessments(id) ON DELETE SET NULL,
  assessment_version integer,
  assessment_key text NOT NULL,
  model_version text NOT NULL,
  context_hash text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('cards','answer')),
  prompt_hash text NOT NULL DEFAULT '',
  result jsonb NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_research_cache_idx
  ON market_research_records (geography_external_id, apparel_segment, assessment_key, model_version, context_hash, record_type, stale, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS market_research_evidence (
  research_id uuid NOT NULL REFERENCES market_research_records(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  publication_date text,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (research_id, url)
);
