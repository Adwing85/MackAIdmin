-- MackAIdmin initial schema

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  cost_center TEXT,
  monthly_budget_usd REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '["developer"]', -- JSON array of Role
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL, -- JSON array
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE assets (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  owner_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  repository_url TEXT,
  environments TEXT NOT NULL DEFAULT '[]',
  data_classification TEXT NOT NULL DEFAULT 'internal',
  processes_personal_data INTEGER NOT NULL DEFAULT 0,
  exposure TEXT NOT NULL DEFAULT 'local',
  autonomy_level INTEGER NOT NULL DEFAULT 1,
  human_in_the_loop INTEGER NOT NULL DEFAULT 1,
  sandboxed INTEGER NOT NULL DEFAULT 0,
  secrets_management TEXT NOT NULL DEFAULT 'none',
  models TEXT NOT NULL DEFAULT '[]',
  capabilities TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  mcp_transport TEXT,
  mcp_endpoint TEXT,
  monthly_budget_usd REAL,
  last_review_at TEXT,
  review_interval_days INTEGER,
  approval_round INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_team ON assets(team_id);

CREATE TABLE asset_permissions (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  justification TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (asset_id, permission)
);

CREATE TABLE asset_dependencies (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  depends_on_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, depends_on_id),
  CHECK (asset_id <> depends_on_id)
);

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  role TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  decision TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  comment TEXT,
  decided_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (asset_id, round, role)
);
CREATE INDEX idx_approvals_pending ON approvals(decision, role);

CREATE TABLE risk_acceptances (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  justification TEXT NOT NULL,
  accepted_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_risk_acceptances_asset ON risk_acceptances(asset_id, rule_id);

CREATE TABLE model_prices (
  model TEXT PRIMARY KEY,
  input_per_mtok REAL NOT NULL,
  output_per_mtok REAL NOT NULL,
  cache_write_per_mtok REAL NOT NULL,
  cache_read_per_mtok REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL, -- YYYY-MM-DD (UTC)
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  source TEXT NOT NULL, -- manual | api | csv | anthropic_claude_code
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_usage_date ON usage_records(date);
CREATE INDEX idx_usage_asset ON usage_records(asset_id, date);
CREATE INDEX idx_usage_person ON usage_records(person_id, date);

CREATE TABLE license_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  vendor TEXT NOT NULL DEFAULT 'Anthropic',
  monthly_price_usd REAL NOT NULL,
  seats_purchased INTEGER NOT NULL DEFAULT 0,
  includes_claude_code INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE license_assignments (
  id INTEGER PRIMARY KEY,
  license_type_id INTEGER NOT NULL REFERENCES license_types(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  last_active_at TEXT
);
CREATE INDEX idx_license_assignments_active ON license_assignments(person_id) WHERE revoked_at IS NULL;

CREATE TABLE redundancy_reviews (
  asset_a INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  asset_b INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  decision TEXT NOT NULL, -- intended | consolidate | false_positive
  note TEXT NOT NULL DEFAULT '',
  decided_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
  decided_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (asset_a, asset_b),
  CHECK (asset_a < asset_b)
);

CREATE TABLE discoveries (
  id INTEGER PRIMARY KEY,
  repo_url TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}', -- JSON
  source TEXT NOT NULL DEFAULT 'scanner',
  status TEXT NOT NULL DEFAULT 'new', -- new | linked | ignored
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (repo_url, path, kind)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  actor_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  changes TEXT -- JSON
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_at ON audit_log(at);
