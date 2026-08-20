-- ============================================================
-- Migration 033: Sincronizacao de leads com Google Contacts
-- ============================================================
-- Objetivo: quando uma lead liga para o telemovel do utilizador, o ecra de
-- chamada mostra o nome em vez de so o numero. Guardamos o resourceName do
-- contacto Google criado/atualizado para cada lead, para editar em vez de
-- duplicar em syncs seguintes.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_contact_resource_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS google_contact_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.google_contact_resource_name IS 'resourceName (people/cXXXX) do contacto Google Contacts sincronizado a partir desta lead. NULL se ainda nao sincronizado ou sem telefone.';
COMMENT ON COLUMN leads.google_contact_synced_at IS 'Timestamp do ultimo sync bem-sucedido com o Google Contacts.';

-- Cache do resourceName do contactGroup "CRM Leads", evita re-listar
-- contactGroups.list a cada sync (ver lib/google-contacts.ts).
ALTER TABLE team_calendar_connections ADD COLUMN IF NOT EXISTS google_contacts_group_resource_name TEXT;

COMMENT ON COLUMN team_calendar_connections.google_contacts_group_resource_name IS 'resourceName do contactGroup "CRM Leads" no Google Contacts do utilizador (cache).';
