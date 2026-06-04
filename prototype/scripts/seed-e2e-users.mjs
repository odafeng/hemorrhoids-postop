// Idempotently provision the E2E test accounts + fixtures so CI never breaks
// when the Supabase auth users / rows get deleted. Uses the service-role admin
// API to set app_metadata, the trusted source for role/study_id claims
// (see migration 20260421b_secure_claims.sql) — user_metadata is forgeable.
//
// Provisions:
//   - patient    (E2E_EMAIL)            role=patient, study_id=TEST-001 + patients row (consented)
//   - researcher (E2E_RESEARCHER_EMAIL) role=researcher
//   - PI         (E2E_PI_EMAIL)         role=pi   (surgical-record + researcher-invite PI flows)
//   - patients row TEST-002              lookup/surgical-record target for the PI flow
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//      E2E_EMAIL/PASSWORD, E2E_RESEARCHER_EMAIL/PASSWORD, E2E_PI_EMAIL/PASSWORD
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STUDY_ID = process.env.E2E_STUDY_ID || 'TEST-001';

if (!url || !serviceKey) {
  console.error('✗ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot seed E2E users');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// surgery date ~2 weeks ago so the patient dashboard renders a sensible POD count
const surgeryDate = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

async function findUserByEmail(email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 200) return null;
  }
}

async function ensureUser(label, email, password, appMeta, userMeta) {
  if (!email || !password) {
    console.log(`• skip ${label}: credentials not set`);
    return;
  }
  const existing = await findUserByEmail(email);
  const attrs = { password, email_confirm: true, app_metadata: appMeta, user_metadata: userMeta };
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, attrs);
    if (error) throw error;
    console.log(`• updated ${label}: ${email} (role=${appMeta.role})`);
  } else {
    const { error } = await admin.auth.admin.createUser({ email, ...attrs });
    if (error) throw error;
    console.log(`• created ${label}: ${email} (role=${appMeta.role})`);
  }
}

async function ensurePatientRow(studyId, extra = {}) {
  const { error } = await admin.from('patients').upsert(
    {
      study_id: studyId,
      age: 45,
      sex: 'M',
      surgery_type: 'hemorrhoidectomy',
      surgery_date: surgeryDate,
      hemorrhoid_grade: 'III',
      app_activated: true,
      study_status: 'active',
      consent_signed: true,
      consent_date: surgeryDate,
      ...extra,
    },
    { onConflict: 'study_id' },
  );
  if (error) throw error;
  console.log(`• patients row ensured: ${studyId}`);
}

try {
  // Patient (logs in → must be consented to reach the dashboard)
  await ensureUser(
    'patient',
    process.env.E2E_EMAIL,
    process.env.E2E_PASSWORD,
    { role: 'patient', study_id: STUDY_ID },
    { role: 'patient', study_id: STUDY_ID, surgery_date: surgeryDate },
  );
  await ensurePatientRow(STUDY_ID);

  // Researcher
  await ensureUser(
    'researcher',
    process.env.E2E_RESEARCHER_EMAIL,
    process.env.E2E_RESEARCHER_PASSWORD,
    { role: 'researcher' },
    { role: 'researcher' },
  );

  // PI flow is opt-in (only seeded when E2E_PI_* is configured) — see project notes.
  if (process.env.E2E_PI_EMAIL && process.env.E2E_PI_PASSWORD) {
    await ensureUser('PI', process.env.E2E_PI_EMAIL, process.env.E2E_PI_PASSWORD, { role: 'pi' }, { role: 'pi' });
    await ensurePatientRow('TEST-002', { surgeon_id: 'HSF' }); // PI lookup / surgical-record target
  }

  console.log('✓ E2E seed complete');
} catch (err) {
  console.error('✗ E2E seed failed:', err.message || err);
  process.exit(1);
}
