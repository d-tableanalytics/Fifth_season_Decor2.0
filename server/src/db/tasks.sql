-- Task Management schema (idempotent). Applied by db/migrate.js after schema.sql.

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY, holiday_date DATE NOT NULL UNIQUE, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS work_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1, weekly_off SMALLINT[] NOT NULL DEFAULT '{0}');
INSERT INTO work_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS task_categories (id SERIAL PRIMARY KEY, name TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS task_categories_name_idx ON task_categories (LOWER(name));

CREATE TABLE IF NOT EXISTS delegations (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  assigner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verifier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES task_categories(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
  verification_required BOOLEAN NOT NULL DEFAULT FALSE,
  deadline TIMESTAMPTZ NOT NULL,
  checkpoints JSONB NOT NULL DEFAULT '[]',
  reminders JSONB NOT NULL DEFAULT '[]',
  reminders_sent JSONB NOT NULL DEFAULT '[]',
  voice_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','completed')),
  submitted_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, completed_note TEXT,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL, verified_at TIMESTAMPTZ, verify_remark TEXT,
  reject_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS delegations_assignee_idx ON delegations (assignee_id, status, deadline);
CREATE INDEX IF NOT EXISTS delegations_assigner_idx ON delegations (assigner_id, status);

CREATE TABLE IF NOT EXISTS checklists (
  id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  assigner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verifier_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES task_categories(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'Medium',
  evidence_required BOOLEAN NOT NULL DEFAULT FALSE,
  verification_required BOOLEAN NOT NULL DEFAULT FALSE,
  frequency TEXT NOT NULL CHECK (frequency IN ('Daily','Weekly','Monthly','Yearly','Periodically','Custom')),
  start_date DATE NOT NULL, end_date DATE, due_time TEXT NOT NULL DEFAULT '10:00',
  config JSONB NOT NULL DEFAULT '{}',
  checkpoints JSONB NOT NULL DEFAULT '[]',
  reminders JSONB NOT NULL DEFAULT '[]',
  voice_key TEXT, active BOOLEAN NOT NULL DEFAULT TRUE,
  delay_rule TEXT NOT NULL DEFAULT 'carry_forward',
  non_functional_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  verify_config JSONB NOT NULL DEFAULT '{}',
  original_assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reassign_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS checklists_assignee_idx ON checklists (assignee_id, active);

CREATE TABLE IF NOT EXISTS checklist_occurrences (
  id SERIAL PRIMARY KEY,
  checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','submitted','completed','not_done','non_functional')),
  checkpoints_done JSONB NOT NULL DEFAULT '[]', reminders_sent JSONB NOT NULL DEFAULT '[]',
  note TEXT, submitted_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, not_done_at TIMESTAMPTZ,
  verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL, verified_at TIMESTAMPTZ, verify_remark TEXT,
  verify_on DATE, verify_notified BOOLEAN NOT NULL DEFAULT FALSE,
  reject_count INTEGER NOT NULL DEFAULT 0,
  non_functional_at TIMESTAMPTZ, non_functional_reason TEXT,
  non_functional_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (checklist_id, due_at));
CREATE INDEX IF NOT EXISTS checklist_occurrences_due_idx ON checklist_occurrences (due_at, status);

CREATE TABLE IF NOT EXISTS deadline_revisions (
  id SERIAL PRIMARY KEY,
  delegation_id INTEGER NOT NULL REFERENCES delegations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'request' CHECK (source IN ('request','assigner','send_back')),
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  old_deadline TIMESTAMPTZ NOT NULL, new_deadline TIMESTAMPTZ NOT NULL, reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL, decided_at TIMESTAMPTZ, decision_remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS deadline_revisions_idx ON deadline_revisions (delegation_id, id);

CREATE TABLE IF NOT EXISTS task_files (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('delegation','checklist','occurrence')),
  ref_id INTEGER NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('attachment','evidence')),
  file_key TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS task_files_ref_idx ON task_files (kind, ref_id);

CREATE TABLE IF NOT EXISTS task_reassignments (
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('delegation','checklist')),
  task_id INTEGER NOT NULL, title TEXT,
  from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  period_from DATE, period_to DATE, reason TEXT,
  is_return BOOLEAN NOT NULL DEFAULT FALSE, at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS task_reassignments_task_idx ON task_reassignments (kind, task_id, id);

CREATE TABLE IF NOT EXISTS task_priority_log (
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL, task_id INTEGER NOT NULL,
  old_priority TEXT NOT NULL, new_priority TEXT NOT NULL, by_user_id INTEGER, at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS task_priority_log_idx ON task_priority_log (kind, task_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'status', title TEXT NOT NULL, body TEXT, link TEXT, actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC);

-- Task Management is a new module: no existing role needs it to keep working, but roles that already had the
-- placeholder "tasks_mine"/"tasks_all" keys keep their grants (same keys, narrower action set).
