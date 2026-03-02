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
-- ============================================================
-- Migration 002: Leads, Interactions, Tasks, Templates
-- ============================================================

-- ─── Enums ───────────────────────────────────────────────────
CREATE TYPE lead_status AS ENUM ('new','qualified','meeting','active','won','lost');
CREATE TYPE interaction_type AS ENUM ('call','whatsapp','email','meeting','note','audio');
CREATE TYPE task_priority AS ENUM ('low','medium','high','urgent');

-- ─── leads ───────────────────────────────────────────────────
CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  assigned_to     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name       TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  source          TEXT,
  campaign_id     UUID,             -- populated after campaigns table exists
  status          lead_status NOT NULL DEFAULT 'new',
  score           INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  urgency         INTEGER DEFAULT 1 CHECK (urgency >= 1 AND urgency <= 5),
  tags            TEXT[] DEFAULT '{}',
  notes           TEXT,
  last_contact_at TIMESTAMPTZ,
  next_action_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_team_id ON leads(team_id);
CREATE INDEX idx_leads_status ON leads(team_id, status);
CREATE INDEX idx_leads_assigned_to ON leads(assigned_to);
CREATE INDEX idx_leads_next_action_at ON leads(next_action_at);
CREATE INDEX idx_leads_last_contact_at ON leads(last_contact_at);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── lead_profiles (1:1 with leads) ──────────────────────────
CREATE TABLE lead_profiles (
  lead_id          UUID PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  home_preferences JSONB,
  financial_profile JSONB,
  personality_traits JSONB,
  family_context   JSONB,
  fears_objections JSONB,
  process_preferences JSONB,
  summary          TEXT,
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lead_profiles_updated_at
  BEFORE UPDATE ON lead_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── interactions ─────────────────────────────────────────────
CREATE TABLE interactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type        interaction_type,
  raw_text    TEXT,
  summary     TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interactions_lead_id ON interactions(lead_id);
CREATE INDEX idx_interactions_occurred_at ON interactions(lead_id, occurred_at DESC);

-- ─── tasks ───────────────────────────────────────────────────
CREATE TABLE tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  due_at      TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  priority    task_priority NOT NULL DEFAULT 'medium',
  created_by  TEXT NOT NULL DEFAULT 'me' CHECK (created_by IN ('agent','me')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_team_id ON tasks(team_id);
CREATE INDEX idx_tasks_lead_id ON tasks(lead_id);
CREATE INDEX idx_tasks_status ON tasks(team_id, status);
CREATE INDEX idx_tasks_due_at ON tasks(due_at);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── message_templates ────────────────────────────────────────
CREATE TABLE message_templates (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  goal       TEXT NOT NULL,
  tone       TEXT NOT NULL DEFAULT 'neutro',
  template   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- leads
CREATE POLICY "team sees own leads"
  ON leads FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create leads"
  ON leads FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));
CREATE POLICY "agents can update leads"
  ON leads FOR UPDATE USING (team_id = auth_team_id() AND auth_has_role('agent'));
CREATE POLICY "admins can delete leads"
  ON leads FOR DELETE USING (team_id = auth_team_id() AND auth_has_role('admin'));

-- lead_profiles
CREATE POLICY "team sees lead profiles"
  ON lead_profiles FOR SELECT
  USING (lead_id IN (SELECT id FROM leads WHERE team_id = auth_team_id()));
CREATE POLICY "agents can upsert lead profiles"
  ON lead_profiles FOR ALL
  USING (lead_id IN (SELECT id FROM leads WHERE team_id = auth_team_id()));

-- interactions
CREATE POLICY "team sees interactions"
  ON interactions FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create interactions"
  ON interactions FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));
CREATE POLICY "agents can update interactions"
  ON interactions FOR UPDATE USING (team_id = auth_team_id() AND auth_has_role('agent'));

-- tasks
CREATE POLICY "team sees tasks"
  ON tasks FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create tasks"
  ON tasks FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));
CREATE POLICY "agents can update tasks"
  ON tasks FOR UPDATE USING (team_id = auth_team_id() AND auth_has_role('agent'));
CREATE POLICY "agents can delete tasks"
  ON tasks FOR DELETE USING (team_id = auth_team_id() AND auth_has_role('agent'));

-- templates
CREATE POLICY "team sees templates"
  ON message_templates FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage templates"
  ON message_templates FOR ALL
  USING (team_id = auth_team_id() AND auth_has_role('agent'));
-- ============================================================
-- Migration 003: Agent System (runs, learnings, uploads, extractions)
-- ============================================================

-- ─── agent_runs (audit log of every agent execution) ─────────
CREATE TABLE agent_runs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_type    TEXT NOT NULL CHECK (agent_type IN ('lead','followup','coach','marketing')),
  trigger_type  TEXT CHECK (trigger_type IN ('manual','n8n_cron','n8n_webhook')),
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  input_summary TEXT,
  output_json   JSONB,
  tokens_used   INTEGER,
  duration_ms   INTEGER,
  status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_runs_team_id ON agent_runs(team_id);
CREATE INDEX idx_agent_runs_agent_type ON agent_runs(team_id, agent_type);
CREATE INDEX idx_agent_runs_lead_id ON agent_runs(lead_id);
CREATE INDEX idx_agent_runs_created_at ON agent_runs(team_id, created_at DESC);

-- ─── agent_learnings (Coach Agent memory) ────────────────────
CREATE TABLE agent_learnings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  learning_type    TEXT NOT NULL CHECK (learning_type IN ('conversion_pattern','objection','timing','source','behavior')),
  content          TEXT NOT NULL,
  evidence_json    JSONB,
  confidence       REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  times_confirmed  INTEGER NOT NULL DEFAULT 1,
  tags             TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_learnings_team_id ON agent_learnings(team_id);
CREATE INDEX idx_agent_learnings_type ON agent_learnings(team_id, learning_type);

CREATE TRIGGER agent_learnings_updated_at
  BEFORE UPDATE ON agent_learnings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── conversation_uploads ─────────────────────────────────────
CREATE TABLE conversation_uploads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('audio','text')),
  storage_path    TEXT,
  transcript_text TEXT,
  objective       TEXT,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversation_uploads_lead_id ON conversation_uploads(lead_id);
CREATE INDEX idx_conversation_uploads_team_id ON conversation_uploads(team_id);

-- ─── agent_extractions (full output of each lead analysis) ───
CREATE TABLE agent_extractions (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  lead_id              UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  upload_id            UUID REFERENCES conversation_uploads(id) ON DELETE SET NULL,
  run_id               UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  extracted_json       JSONB,
  recommendations_json JSONB,
  drafts_json          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_extractions_lead_id ON agent_extractions(lead_id);
CREATE INDEX idx_agent_extractions_team_id ON agent_extractions(team_id);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees agent runs"
  ON agent_runs FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create runs"
  ON agent_runs FOR INSERT WITH CHECK (team_id = auth_team_id());
CREATE POLICY "agents can update runs"
  ON agent_runs FOR UPDATE USING (team_id = auth_team_id());

CREATE POLICY "team sees learnings"
  ON agent_learnings FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage learnings"
  ON agent_learnings FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));

CREATE POLICY "team sees uploads"
  ON conversation_uploads FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create uploads"
  ON conversation_uploads FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));

CREATE POLICY "team sees extractions"
  ON agent_extractions FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can create extractions"
  ON agent_extractions FOR INSERT WITH CHECK (team_id = auth_team_id() AND auth_has_role('agent'));
-- ============================================================
-- Migration 004: Marketing Campaigns & Metrics
-- ============================================================

CREATE TYPE ad_platform AS ENUM ('meta','google','tiktok','organic','other');

-- ─── campaigns ───────────────────────────────────────────────
CREATE TABLE campaigns (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  platform     ad_platform NOT NULL,
  external_id  TEXT,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  budget_daily NUMERIC(10,2),
  budget_total NUMERIC(10,2),
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_team_id ON campaigns(team_id);
CREATE INDEX idx_campaigns_platform ON campaigns(team_id, platform);

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── campaign_metrics (daily performance data) ────────────────
CREATE TABLE campaign_metrics (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  spend        NUMERIC(10,2) NOT NULL DEFAULT 0,
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  leads_count  INTEGER NOT NULL DEFAULT 0,
  cpl          NUMERIC(10,2),
  conversions  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(campaign_id, date)
);

CREATE INDEX idx_campaign_metrics_campaign_id ON campaign_metrics(campaign_id);
CREATE INDEX idx_campaign_metrics_team_date ON campaign_metrics(team_id, date DESC);

-- Add campaign FK to leads table (now that campaigns exists)
ALTER TABLE leads ADD CONSTRAINT fk_leads_campaign
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team sees campaigns"
  ON campaigns FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage campaigns"
  ON campaigns FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));

CREATE POLICY "team sees campaign metrics"
  ON campaign_metrics FOR SELECT USING (team_id = auth_team_id());
CREATE POLICY "agents can manage metrics"
  ON campaign_metrics FOR ALL USING (team_id = auth_team_id() AND auth_has_role('agent'));
-- ============================================================
-- Migration 005: Notifications
-- ============================================================

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('agent_complete','cold_lead','task_due','tip','info')),
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_team_id ON notifications(team_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id, read);
CREATE INDEX idx_notifications_created_at ON notifications(team_id, created_at DESC);

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own notifications"
  ON notifications FOR SELECT
  USING (team_id = auth_team_id() AND (user_id = auth.uid() OR user_id IS NULL));

CREATE POLICY "system can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (team_id = auth_team_id());

CREATE POLICY "user can mark read"
  ON notifications FOR UPDATE
  USING (team_id = auth_team_id() AND (user_id = auth.uid() OR user_id IS NULL));
