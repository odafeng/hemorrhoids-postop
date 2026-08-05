// Supabase-backed data service
// Replaces LocalStorage with Supabase queries
// Falls back to LocalStorage when offline or unauthenticated (demo mode)

import supabase from './supabaseClient';
import { logError } from './errorLogger';

// =====================
// Auth helpers
// =====================
export async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, metadata = {}) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadata },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

/**
 * Set a new password for the currently authenticated user.
 *
 * The recovery link only establishes a session — it does NOT change the
 * password. Without this call the user lands back in the app still holding the
 * old (or, after an admin rotation, an unknown) password, which is exactly what
 * "the reset link just takes me to the app" looks like.
 */
export async function updatePassword(newPassword) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange(callback);
}

// =====================
// Patient data
// =====================
export async function getPatient(studyId) {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('study_id', studyId)
    .single();
  if (error) {
    console.error('[getPatient] failed', {
      studyId,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }
  return data;
}

/**
 * Check if a study_id already exists in the patients table.
 *
 * BEST-EFFORT ONLY. During patient self-registration the caller is still
 * anonymous, so get_user_role() is 'anon' and RLS filters every row — this
 * always reports "free" regardless of the truth. It only returns a real
 * answer for an authenticated researcher/PI.
 *
 * Uniqueness is therefore enforced server-side: patient-onboard refuses with
 * 409 when the study_id already belongs to another account. Treat a positive
 * result here as a friendly early warning, never as the guarantee.
 */
export async function checkStudyIdExists(studyId) {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from('patients')
    .select('study_id')
    .eq('study_id', studyId)
    .maybeSingle();
  if (error) return false; // RLS may block — assume not exists
  return !!data;
}

/**
 * Reset a patient's password (researcher/PI only — calls admin API via Edge Function)
 */
export async function adminResetPassword(targetEmail, newPassword) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl || !supabase) throw new Error('Not configured');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');

  const res = await fetch(`${supabaseUrl}/functions/v1/admin-reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email: targetEmail, newPassword }),
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Password reset failed');
  return result;
}

// =====================
// Surgical records
// =====================

/**
 * Fetch the single surgical record for a patient (null if none).
 */
export async function getSurgicalRecord(studyId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('surgical_records')
    .select('*')
    .eq('study_id', studyId)
    .maybeSingle();
  if (error) {
    console.error('[getSurgicalRecord]', error.message);
    return null;
  }
  return data;
}

/**
 * Upsert surgical record. Caller must supply surgeon_id on payload.
 * RLS WITH CHECK will reject cross-surgeon writes (Postgres 42501).
 */
export async function saveSurgicalRecord(studyId, record) {
  if (!supabase) throw new Error('Supabase not configured');
  const payload = {
    ...record,
    study_id: studyId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('surgical_records')
    .upsert(payload, { onConflict: 'study_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// =====================
// Researcher onboarding (PI-only)
// =====================

/**
 * PI invites a new researcher (or another PI) by email.
 * Calls the researcher-invite Edge Function which uses service_role to
 * create the auth.users row + send an invitation email with set-password link.
 * @param {string} email
 * @param {string} displayName
 * @param {'researcher'|'pi'} role
 */
export async function inviteResearcher(email, displayName, role = 'researcher', surgeonId = null) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('未登入');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const resp = await fetch(`${supabaseUrl}/functions/v1/researcher-invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, display_name: displayName, role, surgeon_id: surgeonId }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || `邀請失敗 (${resp.status})`);
  return result;
}

/**
 * PI-only: list all researchers and PIs.
 * Returns [{ id, email, display_name, role, invited_at, created_at, last_sign_in_at, banned_until }]
 */
export async function listResearchers() {
  return await callResearcherManage({ action: 'list' }).then(r => r.users || []);
}

/**
 * PI-only: ban a researcher/PI user (disable their login).
 */
export async function banResearcher(userId) {
  return await callResearcherManage({ action: 'ban', user_id: userId });
}

/**
 * PI-only: unban (re-enable) a researcher/PI user.
 */
export async function unbanResearcher(userId) {
  return await callResearcherManage({ action: 'unban', user_id: userId });
}

/**
 * PI-only: send a password setup email to an existing researcher/PI account.
 */
export async function resendResearcherActivation(userId) {
  return await callResearcherManage({ action: 'resend_activation', user_id: userId });
}

async function callResearcherManage(body) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('未登入');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/researcher-manage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || `管理失敗 (${resp.status})`);
  return result;
}

// =====================
// Invite management (researcher-only)
// =====================

/**
 * Generate a 6-uppercase-letter invite token (patient-friendly, easy to type).
 * 26^6 ≈ 308M combinations — collision risk is negligible for this study size.
 */
function generateInviteToken() {
  // 6 letters — short enough to read aloud and type at the bedside.
  //
  // O, I and L are excluded: these codes are printed and dictated, and a
  // misread character costs a failed registration. That leaves 23^6 ≈ 148M
  // combinations, which is ample here because a token is not a standalone
  // secret — it is bound to one study_id, expires, and is single-use, so
  // guessing one also requires guessing the study_id it belongs to.
  //
  // Must stay within normalizeInviteCode()'s A-Z0-9 set so a stored token
  // always equals the normalised form of whatever the patient types.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// Exposed for tests only — the format contract (length, alphabet, and agreement
// with normalizeInviteCode) is what keeps printed codes usable.
export const __test_generateInviteToken = generateInviteToken;

/**
 * Create a new study invite.
 * @param {string} studyId   e.g. "HSF-042"
 * @param {number} expiresInDays  default 30
 * @returns {Promise<{study_id, invite_token, expires_at, status}>}
 */
export async function createStudyInvite(studyId, expiresInDays = 30) {
  if (!supabase) throw new Error('Supabase not configured');
  const token = generateInviteToken();
  const expires = new Date();
  expires.setDate(expires.getDate() + expiresInDays);

  // Check existing invite for this study_id
  const { data: existing } = await supabase
    .from('study_invites')
    .select('status')
    .eq('study_id', studyId)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'used') {
      throw new Error(`${studyId} 已經被使用過一次，不能重新產生邀請碼`);
    }
    // Unused / expired: replace the old token so patient gets a fresh one
    const { data, error } = await supabase
      .from('study_invites')
      .update({
        invite_token: token,
        status: 'pending',
        expires_at: expires.toISOString(),
      })
      .eq('study_id', studyId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('study_invites')
    .insert({
      study_id: studyId,
      invite_token: token,
      status: 'pending',
      expires_at: expires.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * List all study invites (researcher view)
 */
export async function listStudyInvites() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('study_invites')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[listStudyInvites]', error.message);
    return [];
  }
  return data || [];
}

/**
 * Mint a short-lived signed URL for a signature object.
 * Accepts either a storage path (new format, "consent/HSF-001_...png")
 * or a full public URL (legacy pre-migration rows). Returns null on failure.
 */
export async function getSignedSignatureUrl(pathOrUrl, expiresInSec = 300) {
  if (!pathOrUrl || !supabase) return null;
  let objectPath = pathOrUrl;
  if (pathOrUrl.startsWith('http')) {
    // Legacy pre-migration rows stored full public URLs. The signatures bucket is
    // now private, so those URLs no longer work. Extract the object path by taking
    // everything after '/signatures/' and mint a signed URL instead.
    const match = pathOrUrl.match(/\/signatures\/(.+)$/);
    if (!match) {
      console.error('[getSignedSignatureUrl] Cannot parse legacy URL:', pathOrUrl);
      return null;
    }
    objectPath = match[1];
  }
  const { data, error } = await supabase.storage
    .from('signatures')
    .createSignedUrl(objectPath, expiresInSec);
  if (error) {
    console.error('[getSignedSignatureUrl]', error.message);
    return null;
  }
  return data?.signedUrl || null;
}

/**
 * Record patient consent — updates patients table with consent status + signature URL
 */
export async function recordConsent(studyId, signatureDataUrl) {
  // Upload signature image to Supabase Storage (private bucket; RLS-gated)
  // Store the file PATH (not a public URL) — consumers mint short-lived
  // signed URLs on demand via getSignedSignatureUrl().
  let signatureUrl = null;
  if (signatureDataUrl) {
    const blob = await (await fetch(signatureDataUrl)).blob();
    const fileName = `consent/${studyId}_${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('signatures')
      .upload(fileName, blob, { contentType: 'image/png', upsert: true });
    if (!uploadError) {
      // Persist the object path; PI-side review UI calls getSignedSignatureUrl().
      signatureUrl = fileName;
    } else {
      console.error('[recordConsent] signature upload failed:', uploadError.message);
    }
  }

  const { error } = await supabase
    .from('patients')
    .update({
      consent_signed: true,
      consent_date: new Date().toISOString(),
      consent_signature_url: signatureUrl,
    })
    .eq('study_id', studyId);

  if (error) throw error;
  return { signatureUrl };
}

/**
 * Ensure patient record exists via server-side Edge Function.
 * The Edge Function uses service_role to bypass RLS safely.
 *
 * THROWS on failure — callers must not treat a failed onboard as "done".
 * Swallowing the error here used to strand the patient: the caller had
 * already dropped the one-shot invite_token, leaving an auth account with
 * no patients row and no UI path to re-enter the code.
 *
 * @param {string} studyId
 * @param {string} [inviteToken] - Required for new patient registration
 * @throws {Error} with `.status` set to the HTTP status when the server replied
 */
export async function ensurePatient(studyId, inviteToken) {
  const existing = await getPatient(studyId);
  if (existing) return existing;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    // Demo mode — create a fake patient
    return { study_id: studyId, surgery_date: new Date().toLocaleDateString('en-CA') };
  }

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${supabaseUrl}/functions/v1/patient-onboard`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ invite_token: inviteToken || null }),
  });

  let result = {};
  try {
    result = await res.json();
  } catch {
    // Non-JSON body (gateway error page, empty 502) — fall through to the
    // checks below rather than masking the failure.
    result = {};
  }

  if (!res.ok) {
    console.error('patient-onboard error:', res.status, result.error);
    const err = new Error(result.error || `patient-onboard failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }

  // A 2xx does not prove we reached the Edge Function. A hospital captive
  // portal or corporate proxy answers *every* request with 200 + an HTML login
  // page, which parses to {} here. Returning undefined would look like success
  // to the caller, which would then burn the one-shot invite token for a
  // patient record that was never created. Enrolment happens on hospital
  // Wi-Fi, so this is the likely failure, not a theoretical one.
  if (!result?.patient) {
    console.error('patient-onboard returned no patient:', res.status);
    const err = new Error(`帳號設定失敗：伺服器回應異常 (HTTP ${res.status})，請確認網路連線後重試。`);
    err.status = res.status;
    throw err;
  }
  return result.patient;
}

/**
 * Signed day offset from the surgery date. NEGATIVE before surgery.
 *
 * getPODFromDate() clamps to 0, which is right for a POD label but hides the
 * pre-operative case entirely: a patient enrolled the day before surgery saw
 * "手術當日 · POD 0" and, if they filled the form that evening, produced a
 * report dated the day BEFORE surgery yet stored as pod = 0. Reports upsert on
 * (study_id, report_date), so the real POD 0 the next day became a second row —
 * two POD 0 observations, one of them pre-operative, and nothing in the data to
 * tell them apart afterwards.
 */
export function getDaysFromSurgery(surgeryDate) {
  if (!surgeryDate) return 0;
  const surgery = new Date(surgeryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  surgery.setHours(0, 0, 0, 0);
  return Math.floor((today - surgery) / (1000 * 60 * 60 * 24));
}

export function getPODFromDate(surgeryDate) {
  const surgery = new Date(surgeryDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  surgery.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - surgery) / (1000 * 60 * 60 * 24)));
}

// =====================
// Symptom Reports
// =====================
export async function getAllReports(studyId) {
  const { data, error } = await supabase
    .from('symptom_reports')
    .select('*')
    .eq('study_id', studyId)
    .order('report_date', { ascending: false });
  if (error) {
    console.error('Error fetching reports:', error);
    return [];
  }
  return data || [];
}

export async function getTodayReport(studyId) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
  return getReportByDate(studyId, today);
}

export async function getReportByDate(studyId, reportDate) {
  const { data, error } = await supabase
    .from('symptom_reports')
    .select('*')
    .eq('study_id', studyId)
    .eq('report_date', reportDate)
    .maybeSingle();
  if (error) return null;
  return data;
}

export async function saveReport(studyId, pod, report, reportDate) {
  const date = reportDate || new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local timezone
  const payload = {
    study_id: studyId,
    report_date: date,
    pod: pod,
    pain_nrs: report.pain,
    bleeding: report.bleeding,
    bowel: report.bowel,
    fever: report.fever,
    wound: report.wound,
    urinary: report.urinary || '正常',
    continence: report.continence || '正常',
    report_source: 'app',
  };

  const { data, error } = await supabase
    .from('symptom_reports')
    .upsert(payload, { onConflict: 'study_id,report_date' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// =====================
// Alerts
// =====================
export async function getAlerts(studyId) {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('study_id', studyId)
    .order('triggered_at', { ascending: false });
  // A read failure must not render as "no alerts" — on screen the two are
  // indistinguishable, and this is the study's safety net (persistent bleeding,
  // fever, clots). Throw so the caller shows an error instead of an all-clear.
  if (error) {
    console.error('[getAlerts]', error.message);
    logError(error, { context: 'getAlerts', studyId });
    throw error;
  }
  return data || [];
}

// =====================
// AI Chat
// =====================
export async function getChatLogs(studyId) {
  const { data, error } = await supabase
    .from('ai_chat_logs')
    .select('*')
    .eq('study_id', studyId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

export async function saveChatLog(studyId, userMessage, aiResponse, topic) {
  const { error } = await supabase
    .from('ai_chat_logs')
    .insert({
      study_id: studyId,
      user_message: userMessage,
      ai_response: aiResponse,
      matched_topic: topic || null,
    });
  if (error) console.error('Error saving chat:', error);
}

// =====================
// Usability Surveys
// =====================
export async function saveSurvey(studyId, pod, survey) {
  const today = new Date().toLocaleDateString('en-CA');
  const { error } = await supabase
    .from('usability_surveys')
    .insert({
      study_id: studyId,
      survey_date: today,
      pod_at_survey: pod,
      ...survey,
    });
  if (error) throw error;
}

export async function getSurvey(studyId) {
  const { data, error } = await supabase
    .from('usability_surveys')
    .select('*')
    .eq('study_id', studyId)
    .order('created_at', { ascending: false })
    .maybeSingle();
  if (error) return null;
  return data;
}

// =====================
// Healthcare Utilization
// =====================
export async function getUtilization(studyId) {
  const { data, error } = await supabase
    .from('healthcare_utilization')
    .select('*')
    .eq('study_id', studyId)
    .order('event_date', { ascending: false });
  if (error) return [];
  return data || [];
}

// =====================
// Researcher Queries
// =====================
export async function getAllPatients() {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function getAdherenceSummary() {
  const { data, error } = await supabase
    .from('v_adherence_summary')
    .select('*');
  if (error) return [];
  return data || [];
}

export async function getAllReportsForResearcher() {
  // Supabase default limit is 1000 rows — paginate to get all
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('symptom_reports')
      .select('*')
      .order('study_id', { ascending: true })
      .order('report_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      // Returning the partial set produced a CSV that looked complete but was
      // silently truncated — it would be analysed and filed with the IRB as the
      // full dataset. Fail instead; handleExportCSV already surfaces a throw.
      console.error('[getAllReportsForResearcher]', error.message);
      logError(error, { context: 'getAllReportsForResearcher', rowsFetched: allData.length, from });
      throw new Error(`資料讀取失敗（已取得 ${allData.length} 筆，資料不完整，請重試）：${error.message}`);
    }

    allData = allData.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break; // last page
    from += PAGE_SIZE;
  }

  return allData;
}

export async function getAllAlertsForResearcher() {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('triggered_at', { ascending: false });
  // See getAlerts: "0 active alerts" and "the alert query failed" must never
  // look the same on the PI overview.
  if (error) {
    console.error('[getAllAlertsForResearcher]', error.message);
    logError(error, { context: 'getAllAlertsForResearcher' });
    throw error;
  }
  return data || [];
}

export async function acknowledgeAlert(alertId, acknowledgedBy) {
  const { error } = await supabase
    .from('alerts')
    .update({
      acknowledged: true,
      acknowledged_by: acknowledgedBy || 'researcher',
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', alertId);
  if (error) {
    console.error('[acknowledgeAlert]', error.message);
    throw error;
  }
  // Audit trail
  try {
    await supabase.from('audit_trail').insert({
      actor_role: acknowledgedBy || 'researcher',
      action: 'alert.acknowledge',
      resource: 'alerts',
      resource_id: String(alertId),
    });
  } catch { /* best-effort */ }
}

export async function getUnreviewedChats() {
  const { data, error } = await supabase
    .from('ai_chat_logs')
    .select('*')
    .eq('reviewed', false)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function getAllChatsForResearcher() {
  const { data, error } = await supabase
    .from('ai_chat_logs')
    .select('*')
    // Unreviewed first (false sorts before true), so the 200-row cap can only ever
    // trim already-reviewed history. Sorting by created_at alone pushed the OLDEST
    // rows out of the window once the table passed 200 — exactly the ones waiting
    // longest for review, silently shrinking the study's AI-quality safety net.
    .order('reviewed', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return [];
  return data || [];
}

export async function reviewChat(chatId, result, notes, reviewedBy) {
  const { error } = await supabase
    .from('ai_chat_logs')
    .update({
      reviewed: true,
      review_result: result,
      review_notes: notes || null,
      reviewed_by: reviewedBy || 'researcher',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', chatId);
  if (error) throw error;

  try {
    await supabase.from('audit_trail').insert({
      actor_role: reviewedBy || 'researcher',
      action: 'researcher.review_chat',
      resource: 'ai_chat_logs',
      resource_id: String(chatId),
      detail: { review_result: result, has_notes: !!notes },
    });
  } catch (e) {
    console.warn('[reviewChat] audit trail failed:', e);
  }
}

export async function batchReviewChats(chatIds, result, reviewedBy) {
  const { error } = await supabase
    .from('ai_chat_logs')
    .update({
      reviewed: true,
      review_result: result,
      review_notes: null,
      reviewed_by: reviewedBy || 'researcher',
      reviewed_at: new Date().toISOString(),
    })
    .in('id', chatIds);
  if (error) throw error;

  try {
    await supabase.from('audit_trail').insert({
      actor_role: reviewedBy || 'researcher',
      action: 'researcher.batch_review',
      resource: 'ai_chat_logs',
      detail: { review_result: result, count: chatIds.length },
    });
  } catch (e) {
    console.warn('[batchReviewChats] audit trail failed:', e);
  }
}

// =====================
// Notification Preferences
// =====================
export async function getNotifPrefs(studyId) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('study_id', studyId)
    .maybeSingle();
  if (error) {
    console.error('[getNotifPrefs]', error.message);
    return null;
  }
  return data;
}

export async function upsertNotifPrefs(studyId, prefs) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert({
      study_id: studyId,
      enabled: prefs.enabled,
      hour: prefs.hour,
      minute: prefs.minute,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'study_id' })
    .select()
    .single();
  if (error) {
    console.error('[upsertNotifPrefs]', error.message);
    return null;
  }
  return data;
}

// =====================
// Pending Notifications
// =====================
export async function getPendingNotifications(studyId) {
  const { data, error } = await supabase
    .from('pending_notifications')
    .select('*')
    .eq('study_id', studyId)
    .eq('read', false)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

export async function markNotificationRead(notificationId) {
  const { error } = await supabase
    .from('pending_notifications')
    .update({ read: true })
    .eq('id', notificationId);
  if (error) console.error('[markNotificationRead]', error.message);
}

// =====================
// Push Subscriptions
// =====================
export async function savePushSubscription(studyId, subscription) {
  const sub = subscription.toJSON ? subscription.toJSON() : subscription;
  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert({
      study_id: studyId,
      endpoint: sub.endpoint,
      keys_p256dh: sub.keys.p256dh,
      keys_auth: sub.keys.auth,
      user_agent: navigator.userAgent,
    }, { onConflict: 'study_id,endpoint' })
    .select()
    .single();
  if (error) {
    console.error('[savePushSubscription]', error.message);
    return null;
  }
  return data;
}

export async function removePushSubscription(studyId, endpoint) {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('study_id', studyId)
    .eq('endpoint', endpoint);
  if (error) console.error('[removePushSubscription]', error.message);
}

/**
 * Trigger a server-sent Web Push notification to the current user's own
 * device(s). Unlike reg.showNotification() which is subject to Android's
 * foreground-suppression rules (in-app heads-up only, no sound / vibrate
 * when the PWA is in foreground), this path sends a real Push via the
 * send-test-push Edge Function, which delivers through FCM / APNs and
 * is surfaced by the system as a full notification with vibrate + sound,
 * regardless of whether the app is in foreground or background.
 *
 * Returns:
 *   { ok: true,  sent: number, failed: number }
 *   { ok: false, reason: string, status?: number }
 */
export async function sendTestPush() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, reason: 'not-authenticated' };

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-test-push`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('[sendTestPush] failed:', res.status, body);
      return { ok: false, reason: body?.reason || `http-${res.status}`, status: res.status };
    }
    return { ok: true, sent: body.sent || 0, failed: body.failed || 0 };
  } catch (e) {
    console.error('[sendTestPush] network error:', e);
    return { ok: false, reason: 'network-error' };
  }
}
