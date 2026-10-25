-- Additive Franchise Academy schema. Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS academy_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academy_lessons (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES academy_courses(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  source_text text NOT NULL CHECK (length(source_text) BETWEEN 1 AND 250000),
  telugu_text text NOT NULL CHECK (length(telugu_text) BETWEEN 1 AND 250000),
  required_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  qa jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS academy_lessons_course_status_idx ON academy_lessons (course_id,status,position);

CREATE TABLE IF NOT EXISTS academy_progress (
  learner_id text NOT NULL CHECK (length(learner_id) BETWEEN 8 AND 80),
  lesson_id uuid NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id,lesson_id)
);
