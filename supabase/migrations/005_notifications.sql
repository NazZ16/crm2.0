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
