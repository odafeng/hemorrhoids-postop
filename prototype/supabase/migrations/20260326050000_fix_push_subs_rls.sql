-- Fix push_subscriptions RLS policy to use get_user_study_id() (consistent with other tables)
-- Also add researcher read access

DROP POLICY IF EXISTS "patients own subs" ON push_subscriptions;
CREATE POLICY "patients_own_push_subs" ON push_subscriptions
    FOR ALL
    USING (study_id = get_user_study_id())
    WITH CHECK (study_id = get_user_study_id());

DROP POLICY IF EXISTS "researchers_read_push_subs" ON push_subscriptions;
CREATE POLICY "researchers_read_push_subs" ON push_subscriptions
    FOR SELECT
    USING (get_user_role() IN ('researcher', 'pi'));
