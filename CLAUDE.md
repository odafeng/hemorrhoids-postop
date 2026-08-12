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

## 硬性限制

**這個 repo 是公開的**（`odafeng/hemorrhoids-postop`，PUBLIC）。
受試者姓名、病歷號、email、聯絡方式與任何金鑰一律不得寫入任何檔案，包含日誌與測試資料。
只以 Study ID、角色或類型指涉。commit 時逐一 stage，不要從根目錄 `git add -A`。

**收案期間不要動 production schema。** migration 不會自動套用，
且本地 migration 歷史與 production 不同步——對 production 執行 `db push` 會重放全部歷史。

**`IRB/` 唯讀。** 已送審文件不得修改；更正寫進 `收案文件/` 的執行版本，差異記入 `研究日誌/`。

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
