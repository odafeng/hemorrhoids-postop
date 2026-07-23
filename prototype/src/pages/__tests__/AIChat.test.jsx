import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIChat from '../AIChat';
import { getClaudeResponse } from '../../utils/claudeService';
import { saveChatLog } from '../../utils/supabaseService';

// Mock storage for demo mode
vi.mock('../../utils/storage', () => ({
  getChatHistory: vi.fn().mockReturnValue([]),
  saveChatMessage: vi.fn(),
}));

// Mock claudeService
vi.mock('../../utils/claudeService', () => ({
  getClaudeResponse: vi.fn().mockResolvedValue({ text: 'AI streaming response', source: 'claude' }),
}));

// Mock supabaseService
vi.mock('../../utils/supabaseService', () => ({
  getChatLogs: vi.fn().mockResolvedValue([]),
  saveChatLog: vi.fn().mockResolvedValue({}),
}));

describe('AIChat Page', () => {
  const defaultProps = {
    isDemo: true,
    userInfo: { studyId: 'DEMO-001', pod: 5, role: 'patient' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders disclaimer banner', () => {
    render(<AIChat {...defaultProps} />);
    expect(screen.getByText(/僅提供衛教資訊/)).toBeInTheDocument();
  });

  it('renders welcome message', async () => {
    render(<AIChat {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/術後衛教 AI 助手/)).toBeInTheDocument();
    });
  });

  it('renders quick question buttons', async () => {
    render(<AIChat {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('術後疼痛怎麼辦？')).toBeInTheDocument();
      expect(screen.getByText('出血正常嗎？')).toBeInTheDocument();
      expect(screen.getByText('排便困難怎麼辦？')).toBeInTheDocument();
    });
  });

  const getSendBtn = () => {
    const input = screen.getByPlaceholderText('輸入您的問題…');
    const row = input.closest('.chat-input-row');
    return row.querySelector('.chat-send');
  };

  it('renders input field and send button', () => {
    render(<AIChat {...defaultProps} />);
    expect(screen.getByPlaceholderText('輸入您的問題…')).toBeInTheDocument();
    expect(getSendBtn()).toBeInTheDocument();
  });

  it('send button is disabled when input is empty', () => {
    render(<AIChat {...defaultProps} />);
    expect(getSendBtn()).toBeDisabled();
  });

  it('sends a message when quick question button is clicked', async () => {
    render(<AIChat {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('術後疼痛怎麼辦？')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('術後疼痛怎麼辦？'));

    await waitFor(() => {
      const userBubbles = screen.getAllByText('術後疼痛怎麼辦？');
      expect(userBubbles.length).toBeGreaterThanOrEqual(1);
    });

    await waitFor(() => {
      expect(screen.getByText(/止痛/)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('saves chat messages in demo mode', async () => {
    const { saveChatMessage } = await import('../../utils/storage');
    saveChatMessage.mockClear();

    render(<AIChat {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('術後疼痛怎麼辦？')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('術後疼痛怎麼辦？'));

    await waitFor(() => {
      expect(saveChatMessage).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it('sends message on Enter key press', async () => {
    render(<AIChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('輸入您的問題…');
    fireEvent.change(input, { target: { value: '術後飲食建議' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('術後飲食建議')).toBeInTheDocument();
    });
  });

  it('does NOT send message on Shift+Enter', () => {
    render(<AIChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('輸入您的問題…');
    fireEvent.change(input, { target: { value: '多行文字' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });

    // Input should still have text (not sent)
    expect(input.value).toBe('多行文字');
  });

  it('does not send empty message', () => {
    render(<AIChat {...defaultProps} />);
    const sendBtn = getSendBtn();
    expect(sendBtn).toBeDisabled();
  });

  it('sends message via send button click', async () => {
    render(<AIChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('輸入您的問題…');
    fireEvent.change(input, { target: { value: '傷口怎麼照護？' } });
    const sendBtn = getSendBtn();
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText('傷口怎麼照護？')).toBeInTheDocument();
    });
  });

  it('clears input after sending', async () => {
    render(<AIChat {...defaultProps} />);
    const input = screen.getByPlaceholderText('輸入您的問題…');
    fireEvent.change(input, { target: { value: '測試' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('loads saved chat history on mount', async () => {
    const storage = await import('../../utils/storage');
    storage.getChatHistory.mockReturnValue([
      { role: 'user', text: '之前的問題' },
      { role: 'ai', text: '之前的回答' },
    ]);

    render(<AIChat {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('之前的問題')).toBeInTheDocument();
      expect(screen.getByText('之前的回答')).toBeInTheDocument();
    });

    storage.getChatHistory.mockReturnValue([]);
  });

  // Non-demo mode tests
  describe('non-demo (Supabase) mode', () => {
    const supabaseProps = {
      isDemo: false,
      userInfo: { studyId: 'HEM-001', pod: 5, role: 'patient' },
    };

    it('loads chat logs from Supabase on mount', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getChatLogs.mockResolvedValue([
        { user_message: 'Supabase question', ai_response: 'Supabase answer' },
      ]);

      render(<AIChat {...supabaseProps} />);
      await waitFor(() => {
        expect(sb.getChatLogs).toHaveBeenCalledWith('HEM-001');
        expect(screen.getByText('Supabase question')).toBeInTheDocument();
        expect(screen.getByText('Supabase answer')).toBeInTheDocument();
      });

      sb.getChatLogs.mockResolvedValue([]);
    });

    it('shows welcome message when no chat logs exist', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getChatLogs.mockResolvedValue([]);

      render(<AIChat {...supabaseProps} />);
      await waitFor(() => {
        expect(screen.getByText(/術後衛教 AI 助手/)).toBeInTheDocument();
      });
    });

    it('handles chat log load error gracefully', async () => {
      const sb = await import('../../utils/supabaseService');
      sb.getChatLogs.mockRejectedValue(new Error('Load fail'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<AIChat {...supabaseProps} />);
      await waitFor(() => {
        // Should still show welcome msg
        expect(screen.getByText(/術後衛教 AI 助手/)).toBeInTheDocument();
      });

      errorSpy.mockRestore();
    });

    it('uses Claude API for non-demo messages', async () => {
      const claude = await import('../../utils/claudeService');
      claude.getClaudeResponse.mockResolvedValue({ text: 'Claude says hi', source: 'claude' });

      render(<AIChat {...supabaseProps} />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText('輸入您的問題…')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('輸入您的問題…');
      fireEvent.change(input, { target: { value: '痛' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(claude.getClaudeResponse).toHaveBeenCalled();
      }, { timeout: 3000 });
    });

    it('saves chat log to Supabase after response', async () => {
      const sb = await import('../../utils/supabaseService');
      const claude = await import('../../utils/claudeService');
      claude.getClaudeResponse.mockResolvedValue({ text: 'AI answer', source: 'claude' });

      render(<AIChat {...supabaseProps} />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText('輸入您的問題…')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('輸入您的問題…');
      fireEvent.change(input, { target: { value: '測試' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(sb.saveChatLog).toHaveBeenCalledWith('HEM-001', '測試', 'AI answer', null);
      }, { timeout: 3000 });
    });

    it('handles save error gracefully', async () => {
      const sb = await import('../../utils/supabaseService');
      const claude = await import('../../utils/claudeService');
      claude.getClaudeResponse.mockResolvedValue({ text: 'ok', source: 'claude' });
      sb.saveChatLog.mockRejectedValue(new Error('Save fail'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<AIChat {...supabaseProps} />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText('輸入您的問題…')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('輸入您的問題…');
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalled();
      }, { timeout: 3000 });
      errorSpy.mockRestore();
    });
  });

  it('shows welcome when no studyId and not demo', async () => {
    render(<AIChat isDemo={false} userInfo={{}} />);
    await waitFor(() => {
      expect(screen.getByText(/術後衛教 AI 助手/)).toBeInTheDocument();
    });
  });

  it('shows source labels on AI messages', async () => {
    render(<AIChat {...defaultProps} />);
    await waitFor(() => {
      const labels = screen.getAllByText(/AI · (離線模式|Claude Haiku)/);
      expect(labels.length).toBeGreaterThan(0);
    });
  });
  // A failed AI call returns a user-facing apology with source 'error'. Storing
  // that as an AI reply put an error string into the researcher review queue
  // and into the study's record of AI interactions, where it is
  // indistinguishable from a genuine exchange.
  describe('chat logging on failure', () => {
    const patientProps = {
      isDemo: false,
      userInfo: { studyId: 'HSF-001', pod: 5, role: 'patient' },
    };

    const send = async (text) => {
      const input = screen.getByPlaceholderText(/輸入您的問題/);
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    };

    it('does not log a failed exchange to the study record', async () => {
      getClaudeResponse.mockResolvedValue({
        text: 'AI 衛教暫時不可用，請稍後再試。如有緊急狀況，請聯絡您的醫療團隊。',
        source: 'error',
      });
      render(<AIChat {...patientProps} />);
      await waitFor(() => expect(screen.getByPlaceholderText(/輸入您的問題/)).toBeInTheDocument());

      await send('傷口怎麼照顧？');

      await waitFor(() => expect(getClaudeResponse).toHaveBeenCalled());
      expect(saveChatLog).not.toHaveBeenCalled();
    });

    it('still logs a successful exchange', async () => {
      getClaudeResponse.mockResolvedValue({
        text: '溫水坐浴每次 10-15 分鐘。',
        source: 'claude',
        ragSources: [{ title: '傷口照護 — 溫水坐浴' }],
      });
      render(<AIChat {...patientProps} />);
      await waitFor(() => expect(screen.getByPlaceholderText(/輸入您的問題/)).toBeInTheDocument());

      await send('傷口怎麼照顧？');

      await waitFor(() => expect(saveChatLog).toHaveBeenCalled());
      expect(saveChatLog).toHaveBeenCalledWith(
        'HSF-001',
        '傷口怎麼照顧？',
        '溫水坐浴每次 10-15 分鐘。',
        '傷口照護 — 溫水坐浴',
      );
    });

    it('logs a successful exchange even when RAG matched nothing', async () => {
      getClaudeResponse.mockResolvedValue({ text: '請聯絡醫療團隊。', source: 'claude' });
      render(<AIChat {...patientProps} />);
      await waitFor(() => expect(screen.getByPlaceholderText(/輸入您的問題/)).toBeInTheDocument());

      await send('隨便問一個問題');

      await waitFor(() => expect(saveChatLog).toHaveBeenCalled());
      expect(saveChatLog.mock.calls[0][3]).toBeNull();
    });
  });
});
