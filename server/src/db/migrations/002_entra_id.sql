-- Microsoft Entra ID (OIDC) login

-- Stable identity of a person in Entra ID: "<tenant id>:<object id>".
ALTER TABLE people ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_people_external_id ON people(external_id) WHERE external_id IS NOT NULL;

-- Pending authorization requests (state, nonce, PKCE verifier) – one-time use, short-lived.
CREATE TABLE oidc_logins (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
