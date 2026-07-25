-- Let研究助理（非 PI）也能「確認」自己主刀醫師病人的警示。
--
-- 背景：2026-07-26 發現研究者儀表板的警示「確認」按鈕對所有人（含 PI）都
-- 沒反應。根因是 acknowledgeAlert() 會 UPDATE alerts.acknowledged_by，但
-- production 的 alerts 表從未有這個欄位——補欄位的 migration
-- 20260326070000_alert_acknowledge_cols.sql 因 migration 版本錯位、靠手動
-- 套用，從沒套進 production。UPDATE 因此丟出 42703（column does not exist），
-- 被前端 catch 吞掉只留 console.error，畫面零回饋。
--
-- 這支 migration：
--   1. 再次確保 acknowledged_by 欄位存在（idempotent；本次已手動補進 prod）。
--   2. 新增 researcher 的 UPDATE policy。原本 alerts 只有 pi_manage_alerts
--      (FOR ALL, 限 pi) 能寫，researcher 只有 SELECT，所以非 PI 助理即使有
--      按鈕也無法確認。範圍沿用 production 上 researcher_read_alerts 的
--      surgeon 綁定模型（只能動自己主刀醫師的病人）。
--
-- 手動套用於 production：2026-07-26（Management API）。

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;

DROP POLICY IF EXISTS "researcher_ack_alerts" ON alerts;
CREATE POLICY "researcher_ack_alerts" ON alerts
  FOR UPDATE
  USING (
    get_user_role() = 'researcher'
    AND EXISTS (
      SELECT 1 FROM patients p
      WHERE p.study_id = alerts.study_id
        AND p.surgeon_id = get_user_surgeon_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'researcher'
    AND EXISTS (
      SELECT 1 FROM patients p
      WHERE p.study_id = alerts.study_id
        AND p.surgeon_id = get_user_surgeon_id()
    )
  );
