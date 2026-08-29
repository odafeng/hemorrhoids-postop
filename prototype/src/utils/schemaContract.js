/**
 * Schema contract — single source of truth for symptom_reports fields.
 * Both the frontend (SymptomReport, hooks, alerts) and the DB migration
 * must agree on these field names and allowed values.
 *
 * If you add/remove a field, update this file and re-run tests.
 */

export const SYMPTOM_FIELDS = {
  // DB column → { frontendKey, allowedValues (null = any) }
  pain_nrs:    { frontendKey: 'pain',       type: 'number', range: [0, 10] },
  bleeding:    { frontendKey: 'bleeding',   type: 'enum',   values: ['無', '少量', '持續', '血塊'] },
  bowel:       { frontendKey: 'bowel',      type: 'enum',   values: ['正常', '困難', '未排'] },
  fever:       { frontendKey: 'fever',      type: 'boolean' },
  urinary:     { frontendKey: 'urinary',    type: 'enum',   values: ['正常', '困難', '尿不出來'] },
  continence:  { frontendKey: 'continence', type: 'enum',   values: ['正常', '滲便', '失禁'] },
  wound:       { frontendKey: 'wound',      type: 'text' },
};

// DB columns expected in symptom_reports (excluding auto-managed ones)
export const DB_COLUMNS = [
  'study_id', 'report_date', 'pod',
  ...Object.keys(SYMPTOM_FIELDS),
  'report_source',
];

// Frontend report keys (what SymptomReport.jsx puts in the report object)
export const FRONTEND_REPORT_KEYS = Object.values(SYMPTOM_FIELDS).map(f => f.frontendKey);

/**
 * Tables the researcher dashboard's full backup writes into its JSON.
 * scripts/crf_fill.py reads the CRF workbook's derivable columns out of these
 * exact keys, so renaming one means editing the script too.
 */
export const FULL_BACKUP_TABLES = [
  'patients',
  'symptom_reports',
  'alerts',
  'ai_chat_logs',
  'surgical_records',
  'usability_surveys',
  'healthcare_utilization',
  'adherence_summary',
];

// =====================
// Wound field helpers
// =====================
// Wound is stored as comma-separated multi-select: "腫脹,分泌物" or "其他:發紅"

/**
 * Check if wound value represents "normal" (no issues)
 */
export function isWoundNormal(wound) {
  if (!wound) return true;
  const trimmed = wound.trim();
  return !trimmed || trimmed === '無異常';
}

/**
 * Format raw wound string for display
 * "腫脹,分泌物" → "腫脹、分泌物"
 * "其他:發紅" → "其他（發紅）"
 * "無異常" → "無異常"
 */
export function formatWound(wound) {
  if (!wound || wound.trim() === '無異常') return '無異常';
  return wound
    .split(',')
    .map(w => {
      const trimmed = w.trim();
      if (trimmed.startsWith('其他:')) {
        return `其他（${trimmed.slice(3)}）`;
      }
      return trimmed;
    })
    .join('、');
}
