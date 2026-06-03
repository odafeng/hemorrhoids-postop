import { useState, useEffect } from 'react';
import { getResearcherMockData } from '../utils/storage';
import * as sb from '../utils/supabaseService';
import * as I from '../components/Icons';

export default function ChatReview({ onNavigate, isDemo, userInfo }) {
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState([]);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  useEffect(() => { loadChats(); }, [isDemo]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadChats = async () => {
    setLoading(true);
    try {
      if (isDemo) {
        const mock = getResearcherMockData();
        setChats(mock.chatLogs);
      } else {
        const data = await sb.getAllChatsForResearcher();
        setChats(data);
      }
    } catch (err) {
      console.error('Chat review load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (chatId, result) => {
    try {
      if (!isDemo) {
        await sb.reviewChat(chatId, result, reviewNotes, userInfo?.studyId || 'researcher');
      }
      setChats(prev => prev.map(c =>
        c.id === chatId ? { ...c, reviewed: true, review_result: result, review_notes: reviewNotes } : c
      ));
      setReviewingId(null);
      setReviewNotes('');
    } catch (err) {
      console.error('Review error:', err);
    }
  };

  const unreviewed = chats.filter(c => !c.reviewed);
  const reviewed = chats.filter(c => c.reviewed);

  const handleBatchReview = async (result) => {
    if (unreviewed.length === 0) return;
    setBatchProcessing(true);
    try {
      if (!isDemo) {
        const ids = unreviewed.map(c => c.id);
        await sb.batchReviewChats(ids, result, userInfo?.studyId || 'researcher');
      }
      setChats(prev => prev.map(c => !c.reviewed ? { ...c, reviewed: true, review_result: result } : c));
    } catch (err) {
      console.error('Batch review error:', err);
    } finally {
      setBatchProcessing(false);
      setShowBatchConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--ink-2)', animation: 'pulse 1s infinite', fontFamily: 'var(--font-mono)' }}>載入中…</p>
      </div>
    );
  }

  const sourceChip = (c) => c.matched_topic
    ? <span className="chip chip-ok" style={{ padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)' }}>知識庫</span>
    : <span className="chip chip-warn" style={{ padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)' }}>通用回覆</span>;

  return (
    <div className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => onNavigate('researcherDashboard')} aria-label="返回">
          <I.ArrowLeft width={17} height={17} />
        </button>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
          AI REVIEW
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="page-head">
        <div className="eyebrow">AI 衛教審核 · PAST 24H</div>
        <h1 className="page-title">AI 回覆審核</h1>
        <p className="page-sub">待審核 {unreviewed.length} 則 · 已審核 {reviewed.length} 則</p>
      </div>

      {unreviewed.length > 1 && !showBatchConfirm && (
        <button className="btn btn-secondary" style={{ marginBottom: 12 }}
          onClick={() => setShowBatchConfirm(true)} disabled={batchProcessing}>
          <I.Sparkle width={14} height={14} /> 批次審核全部（{unreviewed.length} 則）
        </button>
      )}
      {showBatchConfirm && (
        <div className="card">
          <p style={{ fontSize: 12.5, marginBottom: 10, color: 'var(--ink-2)' }}>
            將 {unreviewed.length} 則未審核的 AI 回覆全部標記為：
          </p>
          <div className="btn-row">
            <button className="btn btn-review correct" onClick={() => handleBatchReview('correct')} disabled={batchProcessing}>
              {batchProcessing ? '處理中…' : `✓ 全部正確`}
            </button>
            <button className="btn btn-review incorrect" onClick={() => handleBatchReview('incorrect')} disabled={batchProcessing}>
              {batchProcessing ? '處理中…' : `✗ 全部需修正`}
            </button>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 8 }}
            onClick={() => setShowBatchConfirm(false)}>取消</button>
        </div>
      )}

      {unreviewed.length === 0 && reviewed.length === 0 && (
        <div className="empty-state">
          <div style={{ color: 'var(--ok)', marginBottom: 'var(--space-md)' }}>
            <I.Check width={48} height={48} />
          </div>
          <p>尚無 AI 回覆紀錄</p>
        </div>
      )}

      {unreviewed.length === 0 && reviewed.length > 0 && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ color: 'var(--ok)', margin: '0 auto 10px', width: 40, height: 40, display: 'grid', placeItems: 'center' }}>
            <I.Check width={32} height={32} />
          </div>
          <p style={{ color: 'var(--ink-2)', fontSize: 13 }}>所有 AI 回覆皆已審核完畢</p>
        </div>
      )}

      {unreviewed.map((chat) => (
        <div key={chat.id} className="card review-card">
          <div className="review-head">
            <span className="review-id">{chat.study_id}</span>
            {sourceChip(chat)}
            <span className="review-time">{chat.created_at}</span>
          </div>

          <div className="review-label" style={{ marginTop: 4, marginBottom: 4 }}>病人提問</div>
          <div className="review-q">「{chat.user_message}」</div>

          <div className="review-label" style={{ marginTop: 10, marginBottom: 4 }}>AI 回覆</div>
          <div className="review-bubble ai-a" style={{ fontSize: 12.5 }}>{chat.ai_response}</div>

          {reviewingId === chat.id ? (
            <div className="review-actions-expanded">
              <textarea className="survey-textarea"
                placeholder="審核備註（選填）…"
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                rows={2}
                style={{ marginBottom: 10 }} />
              <div className="btn-row">
                <button className="btn btn-review correct" onClick={() => handleReview(chat.id, 'correct')}>
                  ✓ 正確
                </button>
                <button className="btn btn-review incorrect" onClick={() => handleReview(chat.id, 'incorrect')}>
                  ✗ 需修正
                </button>
              </div>
              <button className="btn btn-ghost" style={{ marginTop: 8 }}
                onClick={() => { setReviewingId(null); setReviewNotes(''); }}>取消</button>
            </div>
          ) : (
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setReviewingId(chat.id)}>
              <I.Edit width={14} height={14} /> 審核此則
            </button>
          )}
        </div>
      ))}

      {reviewed.length > 0 && unreviewed.length > 0 && (
        <>
          <div className="divider" />
          <div className="card-kicker" style={{ margin: '0 4px 10px' }}>REVIEWED · {reviewed.length}</div>
          {reviewed.map(chat => (
            <div key={chat.id} className="card review-card" style={{ opacity: 0.75 }}>
              <div className="review-head">
                <span className="review-id">{chat.study_id}</span>
                {sourceChip(chat)}
                <span className={`chip chip-${chat.review_result === 'correct' ? 'ok' : 'danger'}`}
                  style={{ padding: '2px 8px', fontSize: 10, fontFamily: 'var(--font-mono)' }}>
                  {chat.review_result === 'correct' ? '正確' : '需修正'}
                </span>
              </div>
              <div className="review-q" style={{ marginTop: 6 }}>「{chat.user_message}」</div>
              <div className="review-bubble ai-a" style={{ fontSize: 12, marginTop: 8 }}>{chat.ai_response}</div>
              {chat.review_notes && (
                <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                  備註：{chat.review_notes}
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
