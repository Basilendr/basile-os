-- =====================================================================
-- BASILE OS — politiques de sécurité au niveau des lignes (RLS)
--
-- L'application applique déjà l'isolation par utilisateur dans chaque requête
-- (filtre user_id systématique, vérifié par les tests d'intégration).
-- Ces politiques ajoutent une défense en profondeur pour un déploiement
-- PostgreSQL / Supabase où l'application se connecte avec un rôle dédié
-- et positionne l'utilisateur courant :  SET app.user_id = '<uuid>';
-- Pour Supabase Auth, remplacer current_setting('app.user_id') par auth.uid().
-- À appliquer manuellement après les migrations :  psql "$DATABASE_URL" -f database/rls.sql
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','user_preferences','sessions','security_events','integrations','oauth_tokens','oauth_states',
    'projects','project_milestones','tasks','subtasks','note_folders','notes','note_versions','files','contacts',
    'calendar_events','email_messages','notifications','activity_logs','dashboard_widgets',
    'financial_transactions','budgets','savings_goals','automations','automation_runs',
    'ai_conversations','ai_messages','ai_pending_actions','ai_memory','ai_usage','agents','agent_runs',
    'briefings','daily_plans','knowledge_items','knowledge_relationships','embeddings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY owner_isolation ON %I USING (user_id = current_setting('app.user_id', true)::uuid) WITH CHECK (user_id = current_setting('app.user_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_only ON users;
CREATE POLICY self_only ON users USING (id = current_setting('app.user_id', true)::uuid);
