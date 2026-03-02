-- ============================================================
-- Migration 001: Teams & Users
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Updated at trigger function ─────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── teams ───────────────────────────────────────────────────
CREATE TABLE teams (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── team_members ─────────────────────────────────────────────
CREATE TABLE team_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent','viewer')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

CREATE INDEX idx_team_members_user_id ON team_members(user_id);
CREATE INDEX idx_team_members_team_id ON team_members(team_id);

-- ─── Helper function for RLS (returns current user's team_id) ─
CREATE OR REPLACE FUNCTION auth_team_id() RETURNS UUID AS $$
  SELECT team_id FROM team_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Helper function to check role ────────────────────────────
CREATE OR REPLACE FUNCTION auth_has_role(required_role TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE user_id = auth.uid()
      AND team_id = auth_team_id()
      AND (
        role = required_role
        OR (required_role = 'agent' AND role = 'admin')
        OR (required_role = 'viewer' AND role IN ('admin', 'agent'))
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view own team"
  ON teams FOR SELECT
  USING (id = auth_team_id());

CREATE POLICY "admins can update team"
  ON teams FOR UPDATE
  USING (id = auth_team_id() AND auth_has_role('admin'));

CREATE POLICY "view own team membership"
  ON team_members FOR SELECT
  USING (team_id = auth_team_id());

CREATE POLICY "admins manage team members"
  ON team_members FOR ALL
  USING (team_id = auth_team_id() AND auth_has_role('admin'));
