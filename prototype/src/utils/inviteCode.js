/**
 * Canonical form of a study invite code: A-Z0-9 only, upper-cased.
 *
 * Codes are printed on paper and read aloud at enrolment, so patients type
 * them with whatever separators they see, stray spaces, or whatever case their
 * phone keyboard decided on. Validation in the patient-onboard Edge Function is
 * an exact string match, so without normalisation "3978-k9ku-tudm" and
 * "3978 K9KU TUDM" both fail against a stored "3978K9KUTUDM" — and to the
 * patient that is indistinguishable from having been given a bad code.
 *
 * Invite tokens are generated from this alphabet only (see generateInviteToken
 * in supabaseService.js), so discarding everything else loses no information.
 * Stored tokens must be kept in this same canonical form.
 */
export function normalizeInviteCode(raw) {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
