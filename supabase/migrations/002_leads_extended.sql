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
