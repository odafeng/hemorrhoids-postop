// Password recovery used to be half-implemented: resetPasswordForEmail() sent
// the mail, the link worked, Supabase established a session — and the app then
// treated it like any other login and dropped the user on the dashboard. The
// password was never changed, so "忘記密碼" appeared to do nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ updatePassword: vi.fn() }));
vi.mock('../../utils/supabaseService', () => ({ updatePassword: mocks.updatePassword }));

const { default: SetNewPassword } = await import('../SetNewPassword');

const fill = (label, value) =>
  fireEvent.change(screen.getByPlaceholderText(label), { target: { value } });

describe('SetNewPassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actually changes the password — the whole point of the screen', async () => {
    const onDone = vi.fn();
    mocks.updatePassword.mockResolvedValue(undefined);
    render(<SetNewPassword email="p@example.com" onDone={onDone} />);

    fill('至少 6 個字元', 'newpass123');
    fill('請再輸入一次', 'newpass123');
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() => expect(mocks.updatePassword).toHaveBeenCalledWith('newpass123'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('shows which account is being changed', () => {
    render(<SetNewPassword email="p@example.com" onDone={vi.fn()} />);
    expect(screen.getByText(/p@example\.com/)).toBeInTheDocument();
  });

  it('rejects a mismatch instead of silently setting the first value', async () => {
    render(<SetNewPassword email="p@example.com" onDone={vi.fn()} />);
    fill('至少 6 個字元', 'newpass123');
    fill('請再輸入一次', 'newpass124');
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() => expect(screen.getByText('兩次輸入的密碼不一致')).toBeInTheDocument());
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it('enforces the 6-character minimum Supabase would reject anyway', async () => {
    render(<SetNewPassword email="p@example.com" onDone={vi.fn()} />);
    fill('至少 6 個字元', 'abc');
    fill('請再輸入一次', 'abc');
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() => expect(screen.getByText('密碼至少需要 6 個字元')).toBeInTheDocument());
    expect(mocks.updatePassword).not.toHaveBeenCalled();
  });

  it('keeps the user on the screen when the server rejects the change', async () => {
    const onDone = vi.fn();
    // Recovery links are single-use and time-limited; an expired one must not
    // look like success.
    mocks.updatePassword.mockRejectedValue(new Error('Auth session missing!'));
    render(<SetNewPassword email="p@example.com" onDone={onDone} />);

    fill('至少 6 個字元', 'newpass123');
    fill('請再輸入一次', 'newpass123');
    fireEvent.click(screen.getByRole('button', { name: /設定新密碼/ }));

    await waitFor(() => expect(screen.getByText('Auth session missing!')).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
