import { useState, useRef, useEffect, useCallback } from 'react';

const CONSENT_TEXT = `
高雄榮民總醫院 受試者同意書

計畫名稱
中文：結合人工智慧衛教之痔瘡術後數位症狀監測系統：單中心前瞻性先導研究
英文：A Digital Postoperative Symptom Monitoring System With AI-Assisted Patient Education for Hemorrhoid Surgery: A Single-Center Prospective Pilot Study

試驗執行單位：外科部／大腸直腸外科
委託廠商：無（研究者自行發起）
計畫主持人：黃士峯 醫師（主治醫師）
24 小時緊急聯絡人：黃士峯 醫師  電話：0975581005

─────────────────────

受試者被邀請參與此臨床試驗，這份表格提供您本試驗之相關資訊，計畫主持人或其授權人員將會為您說明試驗內容並回答任何疑問。在您的問題尚未獲得滿意的答覆之前，請不要簽署此同意書。您不須立即決定是否參加本試驗，請經過慎重考慮後方予簽名。您須簽署同意書後才能參與本試驗。即使在您同意後，仍然可以隨時退出本試驗而不需任何理由。

試驗目的
本研究是一個台灣單中心的前瞻性先導可行性研究，預計於高雄榮民總醫院收納 50 位接受痔瘡手術之成年患者。研究目的為建立並評估一套以手機應用程式為基礎、結合人工智慧（AI）輔助衛教之術後症狀監測系統的可行性與病人接受度。本研究不涉及任何新藥品、新醫療器材或新醫療技術；您所接受的手術方式為本院既有之標準術式，不會因為參與本研究而有任何改變。本研究屬於最低風險研究，您只需在手機上填寫簡短問卷及瀏覽衛教資訊，不涉及任何侵入性檢查或額外治療。

研究標的物現況
本研究之標的物為一套由研究團隊自行開發之「痔瘡術後數位症狀監測系統」，屬於漸進式網頁應用程式（Progressive Web App, PWA），透過手機瀏覽器即可使用。主要功能包括：
(1) 結構化術後症狀問卷回報
(2) 基於預設規則之自動警示機制
(3) 採用檢索增強生成（RAG）技術之 AI 衛教模組，以經醫師預先審核之術後衛教知識庫為基礎提供衛教資訊。當知識庫中無相符內容時，將以 AI 模型之通用知識回覆，該部分未經逐一審核。AI 衛教模組僅提供一般性衛教資訊，不具備診斷或治療建議功能。本系統尚未取得醫療器材許可證，亦不屬於法規定義之醫療器材，不介入任何治療決策。

納入條件
• 年滿 20 歲
• 於本院接受痔瘡手術（LigaSure hemorrhoidectomy 或 laser hemorrhoidoplasty）
• 可使用智慧型手機並具備基本操作能力

排除條件
• 無法自行操作智慧型手機
• 有認知功能障礙或無法理解知情同意內容
• 同時接受其他肛門直腸手術（如廔管、肛裂手術）

試驗方法及程序
1. 註冊應用程式：研究人員協助您使用邀請碼及研究編號完成註冊，並將 App 加入手機主畫面
2. 每日症狀回報：術後 30 天內透過 App 填寫結構化症狀問卷（每次約 30 秒），內容包含疼痛分數、出血、排便、肛門控制、發燒、排尿及傷口狀況。回報頻率：術後第 0–7 天每日、第 8–14 天每 2 天一次、第 15–30 天每週 1–2 次
3. AI 衛教助手：可隨時詢問術後照護問題。AI 助手優先參考醫師審核之知識庫回覆；無相關內容時以 AI 通用知識回覆（未經個別審核）。所有回覆僅供參考，不構成醫療診斷或治療建議
4. 自動警示：症狀達預設條件時（持續高度疼痛、持續出血、長時間未排便、發燒等），系統自動通知研究團隊。計畫主持人於 24 小時內（不含例假日）檢視並視需要聯繫您。本系統非即時醫療監測服務，不取代緊急處置。若出現大量出血、劇烈疼痛、高燒不退等狀況，請立即前往急診或撥打 119
5. 系統可用性問卷：於術後第 14 天或研究結束時花約 1 分鐘填寫
6. 回診：本研究不改變原有回診安排

可能之風險
1. 資訊焦慮：使用症狀監測可能使您更關注自身症狀
2. 個資外洩：任何電子系統均存在資料外洩之可能；本研究已採多層安全措施將風險降至最低
3. AI 衛教侷限性：AI 僅提供一般衛教資訊，可能無法涵蓋特殊狀況；知識庫無相關內容時以通用知識回覆，可能不精確。AI 助手不會提供診斷或治療建議

若出現任何不適，請儘速撥打 24 小時緊急聯絡人電話：0975581005

其他替代方法
您不一定要參與本研究。若不參與，術後照護將按本院常規進行（紙本衛教、口頭說明及按時回診），不會影響您接受的醫療品質。

試驗預期效益
您將能更有系統地追蹤自身術後恢復狀況，並可隨時獲得衛教資訊。症狀異常時，研究團隊將及時收到通知並可主動關懷。然而無法保證一定能帶來直接好處。研究結果將有助於改善未來痔瘡手術病人的術後照護。

受試者個人資料之保密
1. 去識別化處理：所有研究資料以研究編號取代姓名及病歷號。個人身份資訊（姓名、病歷號、聯絡方式）經加密後儲存於獨立資料表，與症狀回報等研究資料分開存放
2. 權限控管：僅計畫主持人可存取個人身份資訊。您只能看到自己的資料
3. AI 衛教資料處理：傳送至 AI 服務之內容僅限去識別化症狀摘要，不包含任何可辨識您個人身份之資訊。Anthropic 公司明確表示透過 API 傳送之資料不會被用於 AI 模型訓練
4. 資料儲存於符合 SOC 2 Type II 安全標準之雲端平台，所有資料傳輸均經加密處理
5. 如發表研究結果，您的身份仍將保密

試驗之退出與中止
您可自由決定是否參加；過程中可隨時撤銷或中止同意，退出研究，不需任何理由，且不會影響日後醫療照顧。退出前已得到的去識別化資料將保留供研究分析使用。退出後，系統將停止收集新資料。

損害補償與保險
本研究為觀察性質之可行性研究，不涉及任何侵入性處置，對您造成身體損害之可能性極低。若因參與研究而受到任何損害，高雄榮民總醫院願意提供專業醫療照顧及醫療諮詢。您不會因簽署本同意書而喪失在法律上的任何權利。

資料保存與再利用
研究結束後，個人身份資訊依院內規定保存後銷毀。去識別化之研究資料將保留供後續分析使用，保存期限為研究結束後 10 年，期限屆滿後依法銷毀。未來若有新的研究計畫需使用這些去識別化資料，必須通過高雄榮民總醫院人體研究倫理審查委員會的審查。

受試者權益
1. 若對研究工作性質產生疑問、對受試者權利有意見或懷疑因參與研究而受害，可與本院人體研究倫理審查委員會聯繫：
   電話：(07) 342-2121 轉 71518、71585
   傳真：(07) 346-8344
   Email：irb@vghks.gov.tw
2. 研究過程中與您健康有關、可能影響您繼續接受研究意願的任何重大發現，都將即時提供給您
3. 研究期間任何問題或狀況可與黃士峯醫師聯絡：
   24 小時聯繫電話：0975581005
4. 參與補償：於完成應用程式註冊後將獲得新台幣 300 元現金作為參與補償，不與問卷完成率掛鉤

研究經費來源：本院院內計畫。本研究預期不會衍生商業利益。

─────────────────────

IRB：高雄榮民總醫院人體研究倫理審查委員會
同意書版本：Ver 2｜版本日期：2026.04.14
`.trim();

export default function ConsentPage({ userInfo, onConsent, onDecline }) {
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [checks, setChecks] = useState({ purpose: false, risks: false, withdraw: false, data: false });
  const [signatureData, setSignatureData] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const allChecked = Object.values(checks).every(Boolean);
  const canSign = scrolledToBottom && allChecked && !!signatureData;

  const toggle = (k) => setChecks((c) => ({ ...c, [k]: !c[k] }));

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (nearBottom) setScrolledToBottom(true);
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    // Re-initialise backing store + drawing style. Size uses CURRENT rect
    // because the consent page requires scrolling past the full IRB text
    // before reaching the canvas — mount-time rect can be stale.
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };
    resize();
    window.addEventListener('resize', resize);

    // getPos uses a FRESH rect on every event so it's immune to scrolling
    // / zooming / layout shifts. clientX/Y are viewport coords; we need to
    // subtract the canvas's viewport offset to get canvas-local coords.
    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches?.[0] || e.changedTouches?.[0];
      const cx = t ? t.clientX : e.clientX;
      const cy = t ? t.clientY : e.clientY;
      return { x: cx - rect.left, y: cy - rect.top };
    };

    const start = (e) => {
      e.preventDefault();
      isDrawingRef.current = true;
      lastPosRef.current = getPos(e);
      // Draw a dot so a single tap registers too
      const { x, y } = lastPosRef.current;
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
    };
    const move = (e) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastPosRef.current = p;
    };
    const end = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      setSignatureData(canvas.toDataURL('image/png'));
    };

    // Start on canvas only; move/end on window so drags that leave the
    // canvas don't break the stroke.
    canvas.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousedown', start);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      canvas.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  const clearSignature = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setSignatureData(null);
  };

  const handleSubmit = async () => {
    if (!canSign) return;
    setSubmitting(true);
    try {
      await onConsent(signatureData);
    } catch (err) {
      console.error('Consent submit error:', err);
      alert('提交失敗，請重試：' + (err.message || ''));
      setSubmitting(false);
    }
  };

  const today = new Date().toLocaleDateString('zh-TW');
  const studyId = userInfo?.studyId || '—';

  return (
    <div className="consent-view">
      <div className="c-head">
        <div className="c-eyebrow">VGHKS · IRB · VER 2 · 2026.04.14</div>
        <h1 className="c-title">受試者同意書</h1>
        <p className="c-sub">結合人工智慧衛教之痔瘡術後數位症狀監測系統 · 單中心前瞻性先導研究</p>
      </div>

      <div className="c-body">
        <section className="c-section">
          <div className="c-sec-label">01 · 研究目的</div>
          <p>收納 50 位接受痔瘡手術之成年病人，評估結合 AI 輔助衛教之術後症狀監測 App 的可行性與病人接受度。屬於最低風險研究，不涉及新藥、新器材或新技術。</p>
        </section>
        <section className="c-section">
          <div className="c-sec-label">02 · 可能風險</div>
          <p>資訊焦慮 · 個資外洩（已採多層安全措施） · AI 衛教侷限性。不涉及侵入性處置，不改變手術方式或治療決策。若有不適請撥 0975581005。</p>
        </section>
        <section className="c-section">
          <div className="c-sec-label">03 · 資料處理</div>
          <p>研究資料以研究編號取代姓名及病歷號，儲存於 SOC 2 Type II 雲端平台；傳送至 AI 服務之內容已去識別化。去識別化資料保存 10 年，期滿銷毀。</p>
        </section>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="c-fulltext"
        aria-label="完整同意書內容"
      >
        {CONSENT_TEXT}
      </div>

      {!scrolledToBottom && (
        <div className="c-scroll-hint">↓ 請滑至上方區塊最底部以解鎖勾選</div>
      )}

      <div className="c-checks" data-locked={!scrolledToBottom}>
        <label className="c-chk">
          <input type="checkbox" checked={checks.purpose} onChange={() => toggle('purpose')} disabled={!scrolledToBottom} />
          <span>我已閱讀並了解研究目的</span>
        </label>
        <label className="c-chk">
          <input type="checkbox" checked={checks.risks} onChange={() => toggle('risks')} disabled={!scrolledToBottom} />
          <span>我已了解可能的風險與益處</span>
        </label>
        <label className="c-chk">
          <input type="checkbox" checked={checks.withdraw} onChange={() => toggle('withdraw')} disabled={!scrolledToBottom} />
          <span>我了解可隨時退出研究，不影響醫療權益</span>
        </label>
        <label className="c-chk">
          <input type="checkbox" checked={checks.data} onChange={() => toggle('data')} disabled={!scrolledToBottom} />
          <span>我同意資料被去識別化使用於學術研究</span>
        </label>
      </div>

      <div className="c-sig">
        <div className="c-sig-label">
          <span>簽名 · Signature</span>
          {signatureData && (
            <button type="button" className="c-sig-clear" onClick={clearSignature}>清除重簽</button>
          )}
        </div>
        <div className="c-sig-canvas-wrap">
          <canvas ref={canvasRef} className="c-sig-canvas" />
          {!signatureData && <div className="c-sig-placeholder">在此手寫簽名</div>}
        </div>
        <div className="c-sig-meta">
          <span>{today}</span>
          <span>{studyId}</span>
        </div>
      </div>

      <div className="c-actions">
        <button type="button" className="c-btn c-btn-ghost" onClick={onDecline} disabled={submitting}>
          拒絕
        </button>
        <button type="button" className="c-btn c-btn-primary" disabled={!canSign || submitting} onClick={handleSubmit}>
          {submitting ? '提交中…' : '簽署並開始 ›'}
        </button>
      </div>
    </div>
  );
}
