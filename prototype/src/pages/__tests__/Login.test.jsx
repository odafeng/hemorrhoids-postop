import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from '../Login';

const mockSignIn = vi.fn();
const mockSignUp = vi.fn();
const mockResetPassword = vi.fn();
const mockCheckStudyIdExists = vi.fn().mockResolvedValue(false);

vi.mock('../../utils/supabaseService', () => ({
  signIn: (...args) => mockSignIn(...args),
  signUp: (...args) => mockSignUp(...args),
  resetPassword: (...args) => mockResetPassword(...args),
  checkStudyIdExists: (...args) => mockCheckStudyIdExists(...args),
}));

// Find tab button inside .seg element
const getTab = (label) => {
  const segButtons = document.querySelectorAll('.seg button');
  return [...segButtons].find(b => b.textContent.trim() === label);
};
const getRoleToggle = (label) => {
  const roleButtons = document.querySelectorAll('.role-toggle button');
  return [...roleButtons].find(b => b.textContent.trim().includes(label));
};

describe('Login Page', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSignUp.mockReset();
    mockResetPassword.mockReset();
  });

  it('renders login page with title', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByText('術後追蹤系統')).toBeInTheDocument();
    expect(screen.getByText(/痔瘡手術術後症狀監測/)).toBeInTheDocument();
  });

  it('renders email and password fields', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument();
  });

  it('renders login and register tab buttons', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(getTab('登入')).toBeTruthy();
    expect(getTab('註冊')).toBeTruthy();
  });

  it('switches to register mode and shows surgeon selector and invite code fields', () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(getTab('註冊'));
    expect(screen.getByText('請選擇主刀醫師')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('001')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('請輸入研究團隊提供的邀請碼')).toBeInTheDocument();
  });

  it('renders demo mode button', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Demo 模式/ })).toBeInTheDocument();
  });

  it('calls onLogin with demo flag when demo button clicked (patient role default)', () => {
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);
    fireEvent.click(screen.getByRole('button', { name: /Demo 模式/ }));
    expect(onLogin).toHaveBeenCalledWith({ demo: true, studyId: 'DEMO-001' });
  });

  it('calls onLogin with researcher demo when researcher role + demo clicked', () => {
    const onLogin = vi.fn();
    render(<Login onLogin={onLogin} />);
    // Switch role toggle to researcher
    fireEvent.click(getRoleToggle('研究人員'));
    fireEvent.click(screen.getByRole('button', { name: /Demo 模式/ }));
    expect(onLogin).toHaveBeenCalledWith({ demo: true, studyId: 'RESEARCHER', role: 'researcher' });
  });

  it('renders submit button as "登入" in login mode', () => {
    render(<Login onLogin={vi.fn()} />);
    const btn = document.querySelector('button[type="submit"]');
    expect(btn.textContent).toMatch(/登入/);
  });

  it('renders submit button as "建立帳號" in register mode', () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(getTab('註冊'));
    const btn = document.querySelector('button[type="submit"]');
    expect(btn.textContent).toMatch(/建立帳號/);
  });

  it('calls signIn on login form submit', async () => {
    mockSignIn.mockResolvedValue({});
    render(<Login onLogin={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'password123' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith('test@test.com', 'password123');
    });
  });

  it('shows error message in Chinese on login failure', async () => {
    mockSignIn.mockRejectedValue(new Error('Invalid login credentials'));
    render(<Login onLogin={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(screen.getByText('帳號或密碼錯誤，請重新輸入')).toBeInTheDocument();
    });
  });

  it('shows generic error when error has no message', async () => {
    mockSignIn.mockRejectedValue({});
    render(<Login onLogin={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(screen.getByText('登入失敗，請檢查帳號密碼')).toBeInTheDocument();
    });
  });

  it('calls signUp on register form submit', async () => {
    mockSignUp.mockResolvedValue({});
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(getTab('註冊'));
    fireEvent.change(screen.getByPlaceholderText('請輸入研究團隊提供的邀請碼'), { target: { value: 'ABC123' } });
    fireEvent.change(screen.getByDisplayValue('請選擇主刀醫師'), { target: { value: 'HSF' } });
    fireEvent.change(screen.getByPlaceholderText('001'), { target: { value: '99' } });
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'new@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass123' } });
    const dateInput = document.querySelector('input[type="date"]');
    fireEvent.change(dateInput, { target: { value: '2026-03-15' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalled();
      expect(mockSignUp.mock.calls[0][2].study_id).toBe('HSF-099');
    });
    // Supabase has mailer_autoconfirm on, so signUp already established a
    // session — telling the user to "go log in" contradicted what they saw.
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('stashes the invite token for the onboarding step', async () => {
    mockSignUp.mockResolvedValue({});
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(getTab('註冊'));
    fireEvent.change(screen.getByPlaceholderText('請輸入研究團隊提供的邀請碼'), { target: { value: '  ABC123  ' } });
    fireEvent.change(screen.getByDisplayValue('請選擇主刀醫師'), { target: { value: 'HSF' } });
    fireEvent.change(screen.getByPlaceholderText('001'), { target: { value: '99' } });
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'new@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass123' } });
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-03-15' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalled());
    expect(sessionStorage.getItem('invite_token')).toBe('ABC123');
  });

  it('hides the role switch on the register tab (patients only)', () => {
    render(<Login onLogin={vi.fn()} />);
    expect(screen.getByRole('button', { name: /研究人員/ })).toBeInTheDocument();
    fireEvent.click(getTab('註冊'));
    // Registration always creates a patient; researcher/PI accounts come from
    // the PI-only researcher-invite flow.
    expect(screen.queryByRole('button', { name: /研究人員/ })).not.toBeInTheDocument();
  });

  it('shows error when invite code is empty on register', async () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(getTab('註冊'));
    fireEvent.change(screen.getByPlaceholderText('請輸入研究團隊提供的邀請碼'), { target: { value: '  ' } });
    fireEvent.change(screen.getByDisplayValue('請選擇主刀醫師'), { target: { value: 'HSF' } });
    fireEvent.change(screen.getByPlaceholderText('001'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass123' } });
    const dateInput = document.querySelector('input[type="date"]');
    fireEvent.change(dateInput, { target: { value: '2026-03-15' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(screen.getByText('請輸入邀請碼。')).toBeInTheDocument();
    });
  });

  it('shows error when no surgeon selected', async () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(getTab('註冊'));
    fireEvent.change(screen.getByPlaceholderText('請輸入研究團隊提供的邀請碼'), { target: { value: 'ABC' } });
    fireEvent.change(screen.getByPlaceholderText('001'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass123' } });
    const dateInput = document.querySelector('input[type="date"]');
    fireEvent.change(dateInput, { target: { value: '2026-03-15' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(screen.getByText('請選擇主刀醫師。')).toBeInTheDocument();
    });
  });

  it('switches to forgot password mode', () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(screen.getByText('忘記密碼？'));
    expect(screen.getByText('重設密碼')).toBeInTheDocument();
    expect(screen.getByText('發送重設連結')).toBeInTheDocument();
  });

  it('sends reset password email', async () => {
    mockResetPassword.mockResolvedValue({});
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(screen.getByText('忘記密碼？'));
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'forgot@test.com' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith('forgot@test.com');
      expect(screen.getByText(/重設連結已寄出/)).toBeInTheDocument();
    });
  });

  it('returns to login from forgot password', () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(screen.getByText('忘記密碼？'));
    expect(screen.getByText('重設密碼')).toBeInTheDocument();
    fireEvent.click(screen.getByText('← 返回登入'));
    const btn = document.querySelector('button[type="submit"]');
    expect(btn.textContent).toMatch(/登入/);
  });

  it('hides password field in forgot mode', () => {
    render(<Login onLogin={vi.fn()} />);
    fireEvent.click(screen.getByText('忘記密碼？'));
    expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
  });

  it('shows loading state during submission', async () => {
    mockSignIn.mockImplementation(() => new Promise(() => {}));
    render(<Login onLogin={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'test@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'pass123' } });
    fireEvent.submit(document.querySelector('button[type="submit"]'));
    await waitFor(() => {
      expect(screen.getByText(/處理中/)).toBeInTheDocument();
    });
  });
});
