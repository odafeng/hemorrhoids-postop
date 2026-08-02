// Run: deno test supabase/functions/check-adherence/schedule.test.ts
import assert from "node:assert/strict";
import { patientsDueForReminder } from "./schedule.ts";

// The set the DB returns from fn_report_days() — the single definition of the
// protocol (第一週每日、第二週每兩日一次、第三週起每週一次). Hard-coded here only as
// test input; production reads it over RPC so this file cannot drift into being a
// second source of truth.
const REPORT_DAYS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 13, 20, 27]);

const SURGERY = "2026-07-24";
const at = (pod: number) => {
  const d = new Date(`${SURGERY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + pod);
  return d.toISOString().split("T")[0];
};

const one = (pod: number) =>
  patientsDueForReminder([{ study_id: "HSF-001", surgery_date: SURGERY }], at(pod), REPORT_DAYS);

Deno.test("第一週每日皆提醒", () => {
  for (let pod = 0; pod <= 7; pod++) {
    assert.deepEqual(one(pod), [{ study_id: "HSF-001", pod }], `POD ${pod} 應提醒`);
  }
});

// The whole point of the change: before this, the cron reminded every day POD 0–30,
// so subjects were nagged on days the consent form never asked them to report.
Deno.test("第二週僅 POD 9/11/13 提醒，其餘日不打擾", () => {
  for (const pod of [9, 11, 13]) {
    assert.equal(one(pod).length, 1, `POD ${pod} 應提醒`);
  }
  for (const pod of [8, 10, 12, 14]) {
    assert.deepEqual(one(pod), [], `POD ${pod} 非回報日，不應提醒`);
  }
});

Deno.test("第三週起僅 POD 20/27 提醒", () => {
  for (const pod of [20, 27]) {
    assert.equal(one(pod).length, 1, `POD ${pod} 應提醒`);
  }
  for (const pod of [15, 16, 21, 26, 28, 30]) {
    assert.deepEqual(one(pod), [], `POD ${pod} 非回報日，不應提醒`);
  }
});

Deno.test("觀察期外不提醒", () => {
  assert.deepEqual(one(31), [], "POD 31 已超出 30 天觀察期");
  assert.deepEqual(one(-1), [], "手術日尚未到");
});

Deno.test("只回傳當日到期者，其餘略過", () => {
  const due = patientsDueForReminder(
    [
      { study_id: "A", surgery_date: at(0) },   // POD 9 today  → due
      { study_id: "B", surgery_date: at(1) },   // POD 8 today  → not
      { study_id: "C", surgery_date: at(2) },   // POD 7 today  → due
    ],
    at(9),
    REPORT_DAYS,
  );
  assert.deepEqual(due, [{ study_id: "A", pod: 9 }, { study_id: "C", pod: 7 }]);
});
