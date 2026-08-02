import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake PostgREST builder that actually applies .order()/.limit() semantics, so
// these tests assert what the query *returns* rather than which methods it called.
// Booleans sort false-then-true ascending, matching Postgres.
let tableRows = [];

function makeBuilder() {
  const orderings = [];
  let limitN = Infinity;
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: (col, opts = {}) => {
      orderings.push({ col, asc: opts.ascending !== false });
      return builder;
    },
    limit: (n) => {
      limitN = n;
      return builder;
    },
    then: (resolve) => {
      const sorted = [...tableRows].sort((a, b) => {
        for (const { col, asc } of orderings) {
          if (a[col] === b[col]) continue;
          const cmp = a[col] < b[col] ? -1 : 1;
          return asc ? cmp : -cmp;
        }
        return 0;
      });
      resolve({ data: sorted.slice(0, limitN), error: null });
    },
  };
  return builder;
}

vi.mock('../supabaseClient', () => ({ default: { from: () => makeBuilder() } }));
vi.mock('../errorLogger', () => ({ logError: vi.fn(), Severity: {} }));

import { getAllChatsForResearcher } from '../supabaseService';

// Oldest first, so the unreviewed ones sit at the far end of a created_at DESC sort.
function buildChats({ unreviewed, reviewed }) {
  const rows = [];
  for (let i = 0; i < unreviewed; i++) {
    rows.push({ id: `u${i}`, created_at: `2026-07-01T00:${String(i).padStart(2, '0')}:00Z`, reviewed: false });
  }
  for (let i = 0; i < reviewed; i++) {
    rows.push({ id: `r${i}`, created_at: `2026-08-01T00:${String(i).padStart(2, '0')}:00Z`, reviewed: true });
  }
  return rows;
}

describe('getAllChatsForResearcher — 審核佇列不得被 200 筆上限截斷', () => {
  beforeEach(() => {
    tableRows = [];
  });

  // The clinical risk: the review queue is the study's safety net for AI reply
  // quality. Once the table exceeds the 200-row cap, a created_at-only sort pushes
  // the OLDEST chats out of the window — and those are exactly the ones that have
  // been waiting longest for review. A bad AI answer would silently never surface.
  it('保留所有未審核紀錄，即使它們是最舊的且總數超過 200', async () => {
    tableRows = buildChats({ unreviewed: 3, reviewed: 250 });

    const data = await getAllChatsForResearcher();

    const returnedUnreviewed = data.filter((c) => !c.reviewed);
    expect(returnedUnreviewed).toHaveLength(3);
  });

  it('未審核的排在已審核之前，且各自維持新到舊', async () => {
    tableRows = buildChats({ unreviewed: 2, reviewed: 2 });

    const data = await getAllChatsForResearcher();

    expect(data.map((c) => c.id)).toEqual(['u1', 'u0', 'r1', 'r0']);
  });

  it('仍套用 200 筆上限（不是把全表撈回來）', async () => {
    tableRows = buildChats({ unreviewed: 0, reviewed: 250 });

    const data = await getAllChatsForResearcher();

    expect(data).toHaveLength(200);
  });
});
