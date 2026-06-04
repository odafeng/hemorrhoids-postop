import { describe, it, expect } from 'vitest';
import { SYMPTOM_FIELDS, DB_COLUMNS, FRONTEND_REPORT_KEYS } from '../schemaContract';

/**
 * Schema alignment tests — ensures frontend and DB stay in sync.
 * If any of these fail, it means you changed a field in one place
 * but forgot to update the other.
 */

// ── Read source files as text so we can check field names without importing React ──
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(import.meta.dirname, '../../..');

function readSrc(relPath) {
  return readFileSync(resolve(root, relPath), 'utf-8');
}

describe('Schema Alignment — Frontend ↔ DB', () => {

  it('schemaContract has all expected symptom fields', () => {
    const expected = ['pain_nrs', 'bleeding', 'bowel', 'fever', 'urinary', 'continence', 'wound'];
    expect(Object.keys(SYMPTOM_FIELDS).sort()).toEqual(expected.sort());
  });

  it('supabaseService.saveReport sends all DB columns', () => {
    const src = readSrc('src/utils/supabaseService.js');

    // Check each DB symptom column appears in saveReport payload
    for (const col of Object.keys(SYMPTOM_FIELDS)) {
      expect(src).toContain(`${col}:`);
    }
  });

  it('SymptomReport.jsx collects all frontend fields in the report object', () => {
    const src = readSrc('src/pages/SymptomReport.jsx');

    for (const key of FRONTEND_REPORT_KEYS) {
      // Each frontend key should appear in the report object or as a useState
      expect(
        src.includes(`${key},`) || src.includes(`${key}:`) || src.includes(`${key} `)
      ).toBe(true);
    }
  });

  it('hooks.js maps all DB columns in Supabase field mapping', () => {
    const src = readSrc('src/utils/hooks.js');

    // For each field, either the DB column or the frontend key should appear
    for (const [dbCol, { frontendKey }] of Object.entries(SYMPTOM_FIELDS)) {
      const hasDbCol = src.includes(`r.${dbCol}`) || src.includes(`r.${frontendKey}`);
      const hasFrontendKey = src.includes(`${frontendKey}:`) || src.includes(`${frontendKey},`);
      expect(hasDbCol || hasFrontendKey).toBe(true);
    }
  });

  it('alerts.js references all alertable fields correctly', () => {
    const src = readSrc('src/utils/alerts.js');

    // These fields should be referenced in alerts (via r.field or latestReport.field)
    const alertableFields = ['pain', 'bleeding', 'bowel', 'fever', 'urinary', 'continence'];
    for (const field of alertableFields) {
      const found = src.includes(`.${field}`) || src.includes(`'${field}'`);
      expect(found).toBe(true);
    }
  });

  it('migration SQL references all DB columns', () => {
    const src = readSrc('supabase/migrations/20260324000000_urinary_continence.sql');

    // New columns should be in ALTER TABLE
    expect(src).toContain('urinary');
    expect(src).toContain('continence');
  });

  it('enum values in schemaContract match SymptomReport options', () => {
    const src = readSrc('src/pages/SymptomReport.jsx');

    for (const [, field] of Object.entries(SYMPTOM_FIELDS)) {
      if (field.type === 'enum' && field.values) {
        for (const val of field.values) {
          expect(src).toContain(val);
        }
      }
    }
  });

  it('enum values in schemaContract match alert trigger SQL', () => {
    const src = readSrc('supabase/migrations/20260324000000_urinary_continence.sql');

    // Check that alert-critical enum values appear in the trigger SQL
    const criticalValues = ['持續', '血塊', '未排', '尿不出來', '困難', '失禁', '滲便'];
    for (const val of criticalValues) {
      expect(src).toContain(val);
    }
  });

  // ── Schema contract: DB structure smoke tests ──

  it('schema.sql or migrations define patients table with surgery_date', () => {
    const schema = readSrc('db/schema.sql');
    expect(schema).toContain('CREATE TABLE patients');
    expect(schema).toContain('surgery_date');
  });

  it('schema.sql or migrations define alerts table with required columns', () => {
    const schema = readSrc('db/schema.sql');
    expect(schema).toContain('CREATE TABLE alerts');
    expect(schema).toContain('alert_type');
    expect(schema).toContain('alert_level');
    expect(schema).toContain('acknowledged');
  });

  it('all symptom_reports columns exist across schema.sql + migrations', () => {
    const schema = readSrc('db/schema.sql');
    const migration = readSrc('supabase/migrations/20260324000000_urinary_continence.sql');
    const combined = schema + '\n' + migration;

    // Every DB column from schemaContract must appear somewhere
    for (const col of Object.keys(SYMPTOM_FIELDS)) {
      expect(combined).toContain(col);
    }
  });

  it('alert trigger migration fires on INSERT OR UPDATE', () => {
    const triggerFix = readSrc('supabase/migrations/20260326010000_alert_trigger_update.sql');
    expect(triggerFix).toContain('AFTER INSERT OR UPDATE ON symptom_reports');
  });

  it('study_invites table defined in migrations', () => {
    const migration = readSrc('supabase/migrations/20260326020000_study_invites.sql');
    expect(migration).toContain('CREATE TABLE');
    expect(migration).toContain('study_invites');
    expect(migration).toContain('invite_token');
    expect(migration).toContain('status');
    expect(migration).toContain('expires_at');
  });

  it('notification_preferences table defined in migrations', () => {
    const migration = readSrc('supabase/migrations/20260326030000_notification_preferences.sql');
    expect(migration).toContain('notification_preferences');
    expect(migration).toContain('enabled');
    expect(migration).toContain('hour');
    expect(migration).toContain('minute');
  });

  it('audit_trail fixes: INSERT policy + report audit trigger on UPDATE', () => {
    const migration = readSrc('supabase/migrations/20260326040000_audit_trail_fixes.sql');
    expect(migration).toContain('all_roles_insert_audit');
    expect(migration).toContain('AFTER INSERT OR UPDATE ON symptom_reports');
  });

  it('trigger test suite covers UPDATE, dedup, and re-trigger scenarios', () => {
    const tests = readSrc('supabase/tests/test_alert_triggers.sql');
    expect(tests).toContain('TEST-UPD');     // UPDATE test
    expect(tests).toContain('dedup');         // duplicate dedup test
    expect(tests).toContain('TEST-REACK');   // re-trigger after acknowledge
    expect(tests).toContain('TEST-FIXUP');   // correction (abnormal → normal)
  });
});
