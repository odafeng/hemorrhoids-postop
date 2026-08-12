-- ZONE A 異動稽核：pii_patients 的寫入記入 pii_access_log
--
-- 背景：pii_access_log 自 base_schema 建立以來一直是 0 筆。2026-08-12 查出 ZONE A
-- 整層從未接線，稽核觸發器也從未建立。
--
-- 涵蓋範圍的重要限制 —— 讀取抓不到：
--   PostgreSQL 沒有 SELECT trigger。本 migration 只能記錄 INSERT / UPDATE / DELETE。
--   「PI 解密 PII」是 SELECT + pgp_sym_decrypt()，任何 trigger 都攔不到。
--   要稽核讀取必須改走 SECURITY DEFINER 函式並 REVOKE 直接 SELECT 權限，
--   該項於 2026-08-13 經 PI 決定暫不實作（收案期間不動權限）。
--   prototype/docs/audit-trail-events.md 原本記載「needs trigger on pii_access_log」，
--   方向與可行性皆有誤，已於同日更正。
--
-- 套用方式：本檔於 2026-08-13 以單一 DDL 直接對 production 執行，未經 db push。
--   本機 migration 歷史與 production 不同步，db push 會重放全部歷史（見 CLAUDE.md）。
--   此檔僅為存查與日後重建之用。

CREATE OR REPLACE FUNCTION fn_audit_pii_change()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_study_id VARCHAR(20);
BEGIN
  IF TG_OP = 'DELETE' THEN v_study_id := OLD.study_id;
  ELSE                     v_study_id := NEW.study_id;
  END IF;

  INSERT INTO pii_access_log (study_id, accessed_by, access_type, access_reason)
  VALUES (
    v_study_id,
    -- 非 API 情境下 request.jwt.claims 可能是空字串而非 NULL，直接 ::json 會拋錯
    COALESCE(
      NULLIF(current_setting('request.jwt.claims', true), '')::json->>'email',
      session_user
    ),
    lower(TG_OP),
    -- 呼叫端可用 SET LOCAL app.access_reason = '...' 帶入事由
    NULLIF(current_setting('app.access_reason', true), '')
  );
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_pii_change ON pii_patients;

CREATE TRIGGER trg_audit_pii_change
  AFTER INSERT OR UPDATE OR DELETE ON pii_patients
  FOR EACH ROW EXECUTE FUNCTION fn_audit_pii_change();
