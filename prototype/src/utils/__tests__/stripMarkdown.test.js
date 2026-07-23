// AIChat renders `{msg.text}` as plain React text — there is no Markdown
// parser — so any Markdown the model emits reaches the patient as literal
// syntax characters. The system prompt forbids Markdown, but that is an
// instruction the model can miss: observed 2026-07-23 against Haiku 4.5, where
// an emotionally-pressured question produced `**我不能直接給你用藥或處置建議**`.
import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '../stripMarkdown';

describe('stripMarkdown', () => {
  it('removes the bold that actually leaked in production testing', () => {
    expect(stripMarkdown('**我不能直接給你用藥或處置建議**，因為這需要醫師判斷'))
      .toBe('我不能直接給你用藥或處置建議，因為這需要醫師判斷');
  });

  it.each([
    ['## 傷口照護', '傷口照護'],
    ['*溫水坐浴*很重要', '溫水坐浴很重要'],
    ['> 請注意', '請注意'],
    ['- 每日三次', '・每日三次'],
    ['[回診須知](https://example.com)', '回診須知'],
    ['請服用 `paracetamol`', '請服用 paracetamol'],
  ])('strips %j', (input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });

  it('leaves compliant plain text untouched', () => {
    const clean = '溫水坐浴每次 10-15 分鐘。\n\n✅ 水溫約 40°C\n・每天 3-4 次\n\n💡 如有疑慮請聯絡醫療團隊';
    expect(stripMarkdown(clean)).toBe(clean);
  });

  it('preserves the ・ bullets and emoji the prompt asks for', () => {
    const t = '⚠️ 感染的警示信號\n・分泌物呈黃綠色\n・傷口周圍明顯紅腫';
    expect(stripMarkdown(t)).toBe(t);
  });

  describe('streaming', () => {
    it('hides an unclosed bold marker so asterisks never flash', () => {
      // Mid-stream: the closing ** has not arrived yet.
      expect(stripMarkdown('您好，**我不能', { streaming: true })).toBe('您好，我不能');
    });

    it('hides a single unclosed asterisk and backtick', () => {
      expect(stripMarkdown('請服用 *', { streaming: true })).toBe('請服用 ');
      expect(stripMarkdown('請服用 `', { streaming: true })).toBe('請服用 ');
    });

    it('keeps trailing markers when not streaming, so nothing is lost silently', () => {
      expect(stripMarkdown('您好，**我不能')).toBe('您好，**我不能');
    });

    it('converges on the same output once the span closes', () => {
      const partial = stripMarkdown('您好，**我不能', { streaming: true });
      const complete = stripMarkdown('您好，**我不能給建議**');
      expect(complete.startsWith(partial)).toBe(true);
      expect(complete).toBe('您好，我不能給建議');
    });
  });

  it('passes through empty and nullish input unchanged', () => {
    expect(stripMarkdown('')).toBe('');
    expect(stripMarkdown(null)).toBe(null);
    expect(stripMarkdown(undefined)).toBe(undefined);
  });
});
