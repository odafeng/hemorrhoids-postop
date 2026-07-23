// Custom React Query hooks for patient data
// Handles both demo (localStorage) and Supabase modes

import { useQuery } from '@tanstack/react-query';
import {
  getPOD, getTodayReport as getLocalToday,
  getAllReports as getLocalReports, getSurgeryDate,
  getSurveyLocal,
} from './storage';
import * as sb from './supabaseService';
import { checkAlerts } from './alerts';

// Map server-side alert rows to the display shape Dashboard expects
const ALERT_DISPLAY = {
  high_pain:            { icon: '🔴', title: '持續性高度疼痛' },
  ascending_pain:       { icon: '📈', title: '疼痛逐日上升' },
  persistent_bleeding:  { icon: '🩸', title: '持續性出血' },
  blood_clot:           { icon: '🩸', title: '出血伴隨血塊' },
  no_bowel:             { icon: '⚠️', title: '超過3天未排便' },
  fever:                { icon: '🌡️', title: '發燒' },
  urinary_retention:    { icon: '🚨', title: '完全尿不出來' },
  urinary_difficulty:   { icon: '⚠️', title: '排尿困難' },
  incontinence:         { icon: '🚨', title: '肛門失禁' },
  soiling:              { icon: '⚠️', title: '持續滲便' },
};

function mapServerAlerts(serverAlerts) {
  return serverAlerts
    .filter(a => !a.acknowledged)
    .map(a => {
      const display = ALERT_DISPLAY[a.alert_type] || { icon: '⚠️', title: a.alert_type };
      return {
        id: a.id,
        type: a.alert_level || 'warning',
        icon: display.icon,
        title: display.title,
        message: a.message,
      };
    });
}

/**
 * Fetch all patient dashboard data in one query.
 * Returns: { pod, surgeryDate, todayReport, allReports, alerts, adherence, surveyDone }
 */
export function useDashboardData(isDemo, userInfo) {
  return useQuery({
    queryKey: ['dashboard', isDemo, userInfo?.studyId],
    queryFn: async () => {
      if (isDemo) {
        const pod = getPOD();
        const todayReport = getLocalToday();
        const allReports = getLocalReports();
        const surgeryDate = getSurgeryDate();
        const mapped = allReports.map(r => ({ ...r, pain: r.pain ?? r.pain_nrs }));
        const alerts = checkAlerts(mapped);
        const adherence = calcAdherence(allReports.length, pod);
        const surveyDone = getSurveyLocal() !== null;
        return { pod, surgeryDate, todayReport, allReports, alerts, adherence, surveyDone, pendingNotifs: [] };
      }

      // Supabase mode
      const studyId = userInfo?.studyId;
      if (!studyId) throw new Error('No study ID');

      const patient = await sb.getPatient(studyId);
      if (!patient) {
        throw new Error('MISSING_PATIENT: No patient record found for study_id=' + studyId +
          '. Possible causes: RLS policy, session mismatch, or patient-onboard not completed.');
      }
      if (!patient.surgery_date) {
        throw new Error('MISSING_SURGERY_DATE: Patient record exists but surgery_date is null for study_id=' + studyId);
      }
      const surgeryDate = patient.surgery_date;
      const pod = sb.getPODFromDate(surgeryDate);
      // Signed offset: negative while the patient is enrolled but not yet
      // operated on. `pod` alone cannot express that (it clamps at 0).
      const daysFromSurgery = sb.getDaysFromSurgery(surgeryDate);

      // Parallel fetch: all independent queries at once
      const [allReports, todayReport, serverAlerts, survey, pendingNotifs] = await Promise.all([
        sb.getAllReports(studyId),
        sb.getTodayReport(studyId),
        sb.getAlerts(studyId),
        sb.getSurvey(studyId).catch(() => null),
        sb.getPendingNotifications(studyId).catch(() => []),
      ]);

      const alerts = mapServerAlerts(serverAlerts);
      const adherence = calcAdherence(allReports.length, pod);
      const surveyDone = !!survey;

      return { pod, daysFromSurgery, surgeryDate, todayReport, allReports, alerts, adherence, surveyDone, pendingNotifs };
    },
    staleTime: 30_000, // Cache for 30 seconds
    retry: 2,
    enabled: isDemo || !!userInfo?.studyId,
  });
}

/**
 * Calculate expected report days based on protocol:
 *   POD 0–7:  daily (8 days)
 *   POD 8–14: every 2 days (4 days: 8,10,12,14)
 *   POD 15–30: twice a week (~5 days)
 * Returns number of expected reports up to current POD.
 */
export function getExpectedReportCount(pod) {
  if (pod < 0) return 0;
  let count = 0;
  for (let d = 0; d <= pod; d++) {
    if (d <= 7) {
      // POD 0–7: daily
      count++;
    } else if (d <= 14) {
      // POD 8–14: every 2 days (even PODs)
      if (d % 2 === 0) count++;
    } else if (d <= 30) {
      // POD 15–30: ~twice a week (every 3–4 days)
      // Use Mon/Thu pattern: days where (d-15) % 3 === 0 or (d-15) % 3 === 2
      const offset = d - 15;
      if (offset % 7 === 0 || offset % 7 === 3) count++;
    }
    // POD > 30: no expected reports
  }
  return Math.max(1, count);
}

/**
 * Calculate adherence rate: actual reports / expected reports
 */
export function calcAdherence(reportCount, pod) {
  const expected = getExpectedReportCount(pod);
  return Math.min(100, Math.round((reportCount / expected) * 100));
}
export function useHistoryData(isDemo, userInfo) {
  return useQuery({
    queryKey: ['history', isDemo, userInfo?.studyId],
    queryFn: async () => {
      if (isDemo) {
        return getLocalReports().sort((a, b) => b.date.localeCompare(a.date));
      }

      const studyId = userInfo?.studyId;
      if (!studyId) throw new Error('No study ID');

      const reports = await sb.getAllReports(studyId);
      return reports.map(r => ({
        date: r.report_date,
        pod: r.pod,
        pain: r.pain_nrs,
        bleeding: r.bleeding,
        bowel: r.bowel,
        fever: r.fever,
        wound: r.wound,
        urinary: r.urinary,
        continence: r.continence,
      }));
    },
    staleTime: 30_000,
    retry: 2,
    enabled: isDemo || !!userInfo?.studyId,
  });
}
