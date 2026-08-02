import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ChatReview from '../ChatReview';

vi.mock('../../utils/supabaseService', () => ({
  getAllChatsForResearcher: vi.fn(),
  reviewChat: vi.fn(),
  batchReviewChats: vi.fn(),
}));
vi.mock('../../utils/storage', () => ({ getResearcherMockData: vi.fn() }));
import * as sb from '../../utils/supabaseService';

const staleChat = {
  id: 1,
  study_id: 'HSF-001',
  user_message: '傷口一直滲血正常嗎？',
  ai_response: '少量滲血在術後前幾天常見…',
  matched_topic: null,
  reviewed: false,
  created_at: '2026-07-25 03:00:00+00', // 8 days before the reviewer opens the page
};

describe('ChatReview — 審核佇列涵蓋範圍', () => {
  beforeEach(() => {
    sb.getAllChatsForResearcher.mockResolvedValue([staleChat]);
  });

  // The queue is the study's safety net for AI reply quality. getAllChatsForResearcher
  // applies no time filter, so a reply left unreviewed for days must still appear —
  // if it silently aged out, a bad AI answer would never get caught.
  it('列出超過 24 小時仍未審核的回覆', async () => {
    render(<ChatReview onNavigate={() => {}} isDemo={false} userInfo={{ studyId: 'HSF' }} />);
    await waitFor(() => {
      expect(screen.getByText(/傷口一直滲血正常嗎/)).toBeInTheDocument();
    });
    expect(screen.getByText(/待審核 1 則/)).toBeInTheDocument();
  });

  // The header used to read "PAST 24H" while the query returned everything, which
  // told the reviewer the opposite of what they were looking at: a full backlog
  // presented as one day's work.
  it('標題不宣稱只涵蓋 24 小時', async () => {
    render(<ChatReview onNavigate={() => {}} isDemo={false} userInfo={{ studyId: 'HSF' }} />);
    await waitFor(() => expect(screen.getByText(/AI 回覆審核/)).toBeInTheDocument());
    expect(screen.queryByText(/24\s*H/i)).toBeNull();
    expect(screen.getByText(/最近 200 則/)).toBeInTheDocument();
  });
});
