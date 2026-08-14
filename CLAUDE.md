# 痔瘡術後 AI 衛教追蹤系統

高雄榮總大腸直腸外科 · IRB Ver 2 (2026.04.14) · 目標 50 例 · 30 天追蹤
**收案自 2026-07-23 起進行中——production 上有真實病人。**

## 除錯或改動之前，先查研究日誌

`研究日誌/` 每日一個 YAML，記錄根因、決策理由、驗證範圍與刻意不做的事。
**這些內容 git log 查不到，而且經常直接決定除錯方向。**

```bash
grep -rn "<識別字>" 研究日誌/          # 先搜識別字：函式名、欄位名、error code、HTTP header
grep -rln "resetPasswordForEmail" 研究日誌/
```

搜得動的東西包含 `inviteUserByEmail`、`password_set_at`、`v_adherence_summary`、
`INVITE_EXPIRY_DATE`、`x-vercel-cache`、`ConfirmationURL`、`TEST-001` 等等——
程式碼裡出現過的識別字，日誌裡多半也有。

- `研究日誌/lessons_learned.json` — 跨日教訓，一次讀完，含根因、證據等級與復發徵兆
- `研究日誌/README.md` — 依主題與依日期兩份索引

**這一步的實際價值**：2026-08-12 追一個「重設密碼信沒有連結」的問題時，
`2026-08-05.yaml` 裡「當天在 production 用 Hotmail 完整驗證通過」這一句，
直接推翻了「template 壞掉」的假設，把方向轉到收件端差異。沒有它會繼續繞。

**同時注意**：日誌記的是「當時驗證了什麼」，讀起來卻容易像「這件事沒問題」。
引用舊結論前先確認它的覆蓋範圍。日期較新的紀錄通常推翻較舊的。

## 記錄踩過的坑

### 假設被推翻的當下就要說出來

**每當一個假設被證據推翻，當場講明：原本認為是什麼、推翻它的是什麼。**
不要等到工作尾聲才回想——到那時通往答案的那條線已經把死路壓掉了，回想一定會漏。

死路是日誌裡最省未來時間的內容。「重設信沒連結」的答案只回答了一次問題；
「不是 template，PI 貼出的 template 確含 `{{ .ConfirmationURL }}`」則讓下一個人
直接跳過第一個小時。日誌若只記通往答案的路徑，這些全部流失。

寫進當日 YAML 的 `hypotheses_ruled_out`，每則含 `hypothesis` 與 `disproved_by`。

### 這些情況發生時，主動提議寫一則日誌

不必等 PI 開口。以下每一項都自帶訊號：

- 一個假設被證據推翻
- 同一個問題試了三次以上仍未解決
- production 的行為與本機或測試不一致
- 最後修改的位置與原先預期的不同
- 差一點送出錯誤的東西，或事後才發現前一次的做法有問題
- 為了繞過某個限制而做了非直覺的選擇

提議時直接把草稿寫出來讓 PI 增刪，不要只問「要不要記」。

### 用到舊紀錄時，回頭標記

某則 `lessons_learned.json` 的教訓實際被拿來解決問題時，在該則的 `used_on`
補一筆（日期＋解決了什麼）。這是唯一能看出哪種寫法真的有用的訊號；
沒有它，紀錄品質會隨時間漂移而沒有人察覺。

## 硬性限制

**這個 repo 是公開的**（`odafeng/hemorrhoids-postop`，PUBLIC）。
受試者姓名、病歷號、email、聯絡方式與任何金鑰一律不得寫入任何檔案，包含日誌與測試資料。
只以 Study ID、角色或類型指涉。commit 時逐一 stage，不要從根目錄 `git add -A`。

**收案期間不要動 production schema。** migration 不會自動套用，
且本地 migration 歷史與 production 不同步——對 production 執行 `db push` 會重放全部歷史。

**`IRB/` 唯讀。** 已送審文件不得修改；更正寫進 `收案文件/` 的執行版本，差異記入 `研究日誌/`。

## 每次新收案，要更新兩個地方

`patients` 那一列由 App 註冊流程自己建立，不必手動處理。會被漏掉的是這兩個：

| 位置 | 內容 |
|---|---|
| `收案文件/收案對照表.xlsx` | 序號、Study ID、姓名、病歷號、出生日期、手術日期、主刀醫師、聯絡電話、收案日期、收案狀態 |
| Supabase `pii_patients` | `name_enc` / `birth_date_enc` / `mrn_enc` / `phone_enc`（pgp_sym 加密），加上 consent 與 enrolled 欄位 |

**兩者不會互相提醒，也不會有人報錯。** 2026-08-14 查出 HSF-003/004/005
已經在 `patients` 裡，`pii_patients` 卻一筆都沒有。要確認有沒有漏，直接比對：

```sql
select p.study_id from patients p
left join pii_patients x on x.study_id = p.study_id
where x.study_id is null and p.study_id <> 'TEST-001';
```

### 同一個欄位，兩邊格式不同

聯絡電話在對照表帶破折號（`0912-345-678`），在 `pii_patients` 不帶（`0912345678`）。
照抄會讓密文長度從 76 變成 78。核對不必解密——`pgp_sym_encrypt` 固定 66 bytes
overhead，密文長度減 66 就是明文位元組數，格式對不對一眼看得出來。

### 加密金鑰走 Vault，永遠不要寫出金鑰本身

金鑰自 2026-08-14 起存在 Supabase Vault，名稱 `pii_encryption_key`。一律這樣取用：

```sql
(select decrypted_secret from vault.decrypted_secrets where name = 'pii_encryption_key')
```

**不要請 PI 把金鑰貼進對話，也不要把金鑰寫進任何檔案。** 2026-08-12 曾經發生過一次，
金鑰輪替至今仍未決；Vault 的用意就是讓這件事不必再發生。

寫入 `pii_patients` 時：

- INSERT 前加 `SET LOCAL app.access_reason`，`fn_audit_pii_change` 才記得下來為何動這張表
- `enrolled_at` 取 `patients.created_at`，不要用 `now()`——用 now() 記到的是補登時刻，不是收案時刻
- 驗證用密文長度，不要解密後回傳明文

Vault 可用之後，整段流程可以直接用 Supabase MCP 執行，不必再產生帶金鑰的 SQL 檔給 PI 手動貼上。

### 改對照表的兩個坑

- **寫值不會帶樣式。** 設完 `.value` 要再 `copy()` 前一列的 `_style`，否則新列停在
  空白列的「待填」樣式。只設 font 會漏掉 alignment / border / fill。
- **下拉清單只涵蓋第 6–55 列**（主刀醫師 `G6:G55`、收案狀態 `M6:M55`）。
  超出範圍要一併調整 `dv.sqref`。

改動前先備份成 `收案對照表.bak-YYYYMMDD.xlsx`（`.gitignore` 已涵蓋此命名）。
細節見 `研究日誌/2026-08-13.yaml` 與 `2026-08-14.yaml`。

## 目錄

| 路徑 | 內容 |
|---|---|
| `prototype/` | PWA 本體（Vite + React），含 `supabase/functions/` Edge Functions |
| `研究日誌/` | 每日開發維運日誌、教訓萃取 |
| `IRB/` | 送審文件（唯讀） |
| `收案文件/` | 收案執行文件。對照表、CRF、同意書已列入 `.gitignore`，**但此目錄其他檔案有進版本控制**——新增檔案前先 `git check-ignore -v` 確認 |
| `docs/` | ADR 與研究文件 |

- Production：https://prototype-zeta-black.vercel.app/
- Supabase：`krohucxzthnukbuzfwiu`

## 驗證

於 `prototype/` 下執行：

```bash
npm test                      # vitest
deno test supabase/functions/ # Edge Function 單元測試
npm run lint
npm run build
```

**確認前端是否上線，要比對字串不要比對 hash。** bundle 會 inline `VITE_*`，
本機建置的 hash 與 Vercel 必然不同，比 hash 每次都得到假陰性。正確做法是
curl 線上 bundle，grep 一組本次新增的字串，再 grep 一組本次移除的字串。

**前端與 Edge Function 走不同部署路徑。** Vercel 由 git integration 直接觸發、不等 CI；
Edge Functions 在根目錄 `.github/workflows/ci.yml` 末段才部署。實測相差約五分鐘。
同時改動兩邊時，要告知 PI 等 CI 綠燈後再操作該功能。

## 慣例

- 完成一個工作單元後自動 commit + push，不需另外詢問
- Commit 訊息用英文，遵循 Conventional Commits
- 新功能與修 bug 都要寫測試，沿用專案既有框架（Vitest / Deno / Playwright）
- 當天的工作結束後，把根因、決策理由與驗證範圍寫進 `研究日誌/YYYY-MM-DD.yaml`。
  格式與「優先寫哪四項」見 `研究日誌/README.md`
