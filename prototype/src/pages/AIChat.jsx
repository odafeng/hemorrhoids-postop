import { useState, useRef, useEffect } from 'react';
import { getAIResponse, quickQuestions } from '../utils/mockAI';
import { getClaudeResponse } from '../utils/claudeService';
import { getChatHistory, saveChatMessage } from '../utils/storage';
import * as sb from '../utils/supabaseService';
import * as I from '../components/Icons';

export default function AIChat({ isDemo, userInfo }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const messagesEndRef = useRef(null);

  const welcomeMsg = {
    role: 'ai',
    text: '您好！我是高雄榮總術後衛教 AI 助手。\n\n我可以回答關於痔瘡手術後恢復的一般性問題，例如疼痛管理、傷口照護、飲食建議等。\n\n請選擇下方的常見問題，或直接輸入您的問題。',
  };

  useEffect(() => {
    const load = async () => {
      if (isDemo) {
        const saved = getChatHistory();
        setMessages(saved.length > 0 ? saved : [welcomeMsg]);
      } else if (userInfo?.studyId) {
        try {
          const logs = await sb.getChatLogs(userInfo.studyId);
          if (logs.length > 0) {
            const mapped = logs.flatMap(l => [
              { role: 'user', text: l.user_message },
              { role: 'ai', text: l.ai_response },
            ]);
            setMessages([welcomeMsg, ...mapped]);
          } else {
            setMessages([welcomeMsg]);
          }
        } catch (err) {
          console.error('Chat load error:', err);
          setMessages([welcomeMsg]);
        }
      } else {
        setMessages([welcomeMsg]);
      }
      setLoaded(true);
    };
    load();
  }, [isDemo, userInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loaded) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loaded]);

  const sendMessage = async (text) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    let response;
    let source = 'mock';
    let ragSources = null;
    if (isDemo) {
      await new Promise(r => setTimeout(r, 600 + Math.random() * 800));
      response = getAIResponse(text);
      source = 'mock';
      setMessages(prev => [...prev, { role: 'ai', text: response, source }]);
    } else {
      setMessages(prev => [...prev, { role: 'ai', text: '…', source: 'claude' }]);
      setIsTyping(false);
      const history = messages.filter(m => m.role === 'user' || m.role === 'ai');
      const result = await getClaudeResponse(text.trim(), { conversationHistory: history }, (textSoFar) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'ai', text: textSoFar, source: 'claude' };
          return updated;
        });
      });
      response = result.text;
      source = result.source;
      ragSources = result.ragSources || null;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'ai', text: response, source };
        return updated;
      });
    }

    setIsTyping(false);

    if (isDemo) {
      saveChatMessage({ role: 'user', text: text.trim() });
      saveChatMessage({ role: 'ai', text: response, source });
    } else if (userInfo?.studyId && source !== 'error') {
      // Only real model output belongs in the study record. On failure
      // getClaudeResponse returns source 'error' with a user-facing apology
      // ("AI 衛教暫時不可用…"); logging that stored the apology as if it were an
      // AI reply. It then surfaced in the researcher review queue as a
      // conversation to review, and left rows indistinguishable from genuine
      // interactions in any later count of AI usage or reply quality. The
      // failure itself is already captured by logError() in claudeService.
      try {
        const topic = ragSources && ragSources.length > 0
          ? ragSources.map(s => s.title || s.source_file).join('; ')
          : null;
        await sb.saveChatLog(userInfo.studyId, text.trim(), response, topic);
      } catch (err) {
        console.error('Save chat error:', err);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const labelFor = (source) => {
    if (source === 'error') return <>⚠ 系統通知</>;
    if (source === 'mock') return <><I.Sparkle width={10} height={10} /> AI · 離線模式</>;
    return <><I.Sparkle width={10} height={10} /> AI · Claude Haiku</>;
  };

  return (
    <div className="chat-screen">
      <div className="topbar" style={{ padding: '8px 20px 4px' }}>
        <button className="icon-btn" onClick={() => window.history.back()} aria-label="返回">
          <I.ArrowLeft width={17} height={17} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="card-icon" style={{ width: 26, height: 26 }}>
            <I.Sparkle width={13} height={13} />
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}>AI 衛教助手</div>
            <div style={{ fontSize: 10, color: 'var(--ok)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>● 線上</div>
          </div>
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="chat-disclaimer">
        <I.Shield width={14} height={14} style={{ flex: '0 0 auto', color: 'var(--warn)' }} />
        <span>本系統僅提供衛教資訊，不提供診斷或治療建議。如有緊急狀況請聯絡醫療機構。</span>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`bubble ${msg.role === 'user' ? 'user' : 'ai'}`}>
            {msg.role === 'ai' && (
              <div className="bubble-label">{labelFor(msg.source)}</div>
            )}
            {msg.text}
            {msg.role === 'ai' && msg.source !== 'error' && i > 0 && (
              <div className="bubble-foot">
                僅供衛教參考 · 不構成醫療建議
              </div>
            )}
          </div>
        ))}
        {isTyping && (
          <div className="bubble ai" style={{ opacity: 0.7 }}>
            <div className="bubble-label"><I.Sparkle width={10} height={10} /> AI · Claude Haiku</div>
            <span style={{ letterSpacing: 4 }}>···</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="quick-qs">
          {quickQuestions.map((q, i) => (
            <button key={i} className="quick-q" onClick={() => sendMessage(q)} disabled={isTyping}>{q}</button>
          ))}
        </div>
        <div className="chat-input-row">
          <input className="chat-input" placeholder="輸入您的問題…" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={isTyping} />
          <button className="chat-send" onClick={() => sendMessage(input)} disabled={!input.trim() || isTyping}>
            <I.Send width={14} height={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
