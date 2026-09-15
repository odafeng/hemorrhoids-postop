-- 移除兩個從未被寫入、也沒有任何讀取端的欄位。
--
--   public.pii_patients.national_id_enc   14/14 為 NULL，全系統零引用
--   public.patients.app_activated_at      14/14 為 NULL，全系統零引用
--
-- === 這支 migration 刻意尚未套用 ===
--
-- 收案自 2026-07-23 進行中，CLAUDE.md 明訂收案期間不動 production schema。
-- 且 supabase_migrations.schema_migrations 在 production 記的是 8 碼版本
-- （20260318、20260319…），磁碟上用的是 14 碼，兩邊不同步——`supabase db push`
-- 會把全部歷史重放到有真實病人的資料庫上（詳見 .github/workflows/ci.yml:202-213）。
-- CI 不會套用本檔。收案結束後由人工在 SQL editor 執行，與其他待辦一起。
--
-- === 套用前要重跑的前置檢查 ===
--
-- 依賴狀態是 2026-09-16 的快照，不是永久事實。套用前重跑這三項：
--
--   1) 兩欄仍全為 NULL：
--      select count(*) filter (where national_id_enc is not null) from public.pii_patients;
--      select count(*) filter (where app_activated_at is not null) from public.patients;
--
--   2) 資料庫物件仍無引用（view / routine / policy / index）：
--      select table_name from information_schema.views
--       where table_schema='public'
--         and (view_definition ilike '%app_activated_at%'
--              or view_definition ilike '%national_id_enc%');
--      -- routines、pg_policies、pg_indexes 同理各查一次
--
--   3) repo 外的維運腳本也要數進去（LL-2026-08-23-01）：
--      dashboard.py、daily_summary.py 與 launchd 排程的腳本住在 repo 之外，
--      grep 這個 repo 查不到它們。
--
-- === 為什麼沒有一併移除 patients.app_activated ===
--
-- 那一欄同樣沒有寫入端、同樣恆為 false，但資料庫函式 karen_research_status()
-- 讀它來算 'app_activated' 計數。直接 DROP 會讓該函式在執行時報錯。
-- 要移除的話得先改寫該函式——依 2026-08-28 的決議，啟用率應改由
-- 「至少回報過一次症狀」認定（dashboard.py 已經這樣做了）。
-- 那是另一個變更，不塞進這一支。
--
-- 相關：研究日誌/2026-09-16.yaml#follow_ups、lessons_learned LL-2026-08-28-02

BEGIN;

ALTER TABLE public.pii_patients DROP COLUMN IF EXISTS national_id_enc;
ALTER TABLE public.patients      DROP COLUMN IF EXISTS app_activated_at;

COMMIT;
