#!/usr/bin/env node
/**
 * Integration smoke test — verifies App ↔ Supabase connectivity.
 * Run: node --env-file=.env scripts/integration-check.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing env vars. Run: node --env-file=.env scripts/integration-check.mjs');
  process.exit(1);
}

const anon = createClient(SUPABASE_URL, ANON_KEY);
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

console.log('\n🔍 Integration Check — App ↔ Supabase\n');

// ── 1. Database connectivity ──
console.log('【1】Database Connectivity');

await test('Anon client can connect', async () => {
  const { error } = await anon.from('patients').select('study_id').limit(1);
  // RLS may return empty, but no connection error
  assert(!error, `Anon query failed: ${error?.message}`);
});

await test('Admin client can connect', async () => {
  const { data, error } = await admin.from('patients').select('count').single();
  assert(!error, `Admin query failed: ${error?.message}`);
});

// ── 2. RLS enforcement ──
console.log('\n【2】RLS Enforcement');

await test('Anon cannot read patients without auth', async () => {
  const { data } = await anon.from('patients').select('*');
  // Should return empty (RLS blocks) not error
  assert(Array.isArray(data) && data.length === 0, 'Anon read patients should be empty');
});

await test('Anon cannot insert into patients', async () => {
  const { error } = await anon.from('patients').insert({
    study_id: 'HACK-001',
    surgery_date: '2026-01-01',
  });
  assert(error, 'Insert should be blocked by RLS');
});

await test('Anon cannot read symptom_reports', async () => {
  const { data } = await anon.from('symptom_reports').select('*');
  assert(Array.isArray(data) && data.length === 0, 'Anon read reports should be empty');
});

await test('Anon cannot read ai_chat_logs', async () => {
  const { data } = await anon.from('ai_chat_logs').select('*');
  assert(Array.isArray(data) && data.length === 0, 'Anon read chat logs should be empty');
});

// ── 3. Table schema validation ──
console.log('\n【3】Table Schema');

const EXPECTED_TABLES = [
  'patients', 'symptom_reports', 'alerts', 'ai_chat_logs',
  'study_invites', 'surgical_records', 'usability_surveys',
  'notification_preferences', 'push_subscriptions', 'pending_notifications',
  'audit_trail', 'rag_documents', 'healthcare_utilization',
];

for (const table of EXPECTED_TABLES) {
  await test(`Table "${table}" exists and is queryable`, async () => {
    const { error } = await admin.from(table).select('*').limit(0);
    assert(!error, `Query failed: ${error?.message}`);
  });
}

// ── 4. RAG knowledge base ──
console.log('\n【4】RAG Knowledge Base');

await test('rag_documents has data (衛教知識庫)', async () => {
  const { data, error } = await admin.from('rag_documents').select('id', { count: 'exact', head: true });
  assert(!error, `Query failed: ${error?.message}`);
});

await test('rag_documents has embeddings', async () => {
  const { data, error } = await admin
    .from('rag_documents')
    .select('id, embedding')
    .not('embedding', 'is', null)
    .limit(1);
  assert(!error, `Query failed: ${error?.message}`);
  assert(data.length > 0, 'No documents with embeddings found');
});

// ── 5. Auth system ──
console.log('\n【5】Auth System');

await test('Auth endpoint is reachable', async () => {
  const { data, error } = await anon.auth.getSession();
  assert(!error, `Auth error: ${error?.message}`);
  // No session expected (not logged in), but no error either
});

await test('PI account exists', async () => {
  const { data: { users }, error } = await admin.auth.admin.listUsers();
  assert(!error, `List users failed: ${error?.message}`);
  const pi = users.find(u => u.email === 'odafeng@hotmail.com');
  assert(pi, 'PI account not found');
  assert(pi.app_metadata?.role === 'pi', `Expected role=pi, got ${pi.app_metadata?.role}`);
});

await test('No stale test accounts remain', async () => {
  const { data: { users } } = await admin.auth.admin.listUsers();
  assert(users.length === 1, `Expected 1 user, found ${users.length}: ${users.map(u => u.email).join(', ')}`);
});

// ── 6. Edge Functions ──
console.log('\n【6】Edge Functions');

await test('health endpoint responds', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/health`);
  assert(res.ok, `Health check failed: ${res.status}`);
});

await test('patient-onboard rejects unauthenticated', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/patient-onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({}),
  });
  assert(res.status === 401, `Expected 401, got ${res.status}`);
});

await test('ai-chat rejects unauthenticated', async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ message: 'test' }),
  });
  assert(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
});

// ── 7. Database is clean ──
console.log('\n【7】Clean State');

for (const table of ['patients', 'symptom_reports', 'study_invites', 'surgical_records', 'ai_chat_logs']) {
  await test(`"${table}" is empty (ready for enrollment)`, async () => {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
    assert(!error, `Count failed: ${error?.message}`);
    assert(count === 0, `Expected 0 rows, found ${count}`);
  });
}

// ── Summary ──
console.log(`\n${'═'.repeat(45)}`);
console.log(`  ${passed + failed} tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(45)}\n`);

process.exit(failed > 0 ? 1 : 0);
