// Run: deno test supabase/functions/_shared/followup.test.ts
import assert from "node:assert/strict";
import {
  FOLLOWUP_DAYS,
  followUpEndsOn,
  patientsToClose,
  podFor,
  STUDY_STATUS,
} from "./followup.ts";

const SURGERY = "2026-07-24"; // HSF-001's actual surgery date; POD 30 falls on 2026-08-23
const at = (pod: number) => {
  const d = new Date(`${SURGERY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + pod);
  return d.toISOString().split("T")[0];
};
const active = (overrides = {}) => ({
  study_id: "HSF-001",
  surgery_date: SURGERY,
  study_status: STUDY_STATUS.ACTIVE,
  ...overrides,
});

Deno.test("podFor counts whole days from surgery", () => {
  assert.equal(podFor(SURGERY, SURGERY), 0);
  assert.equal(podFor(SURGERY, "2026-08-23"), 30);
  assert.equal(podFor(SURGERY, "2026-08-28"), 35);
});

Deno.test("followUpEndsOn is the surgery date plus the window", () => {
  assert.equal(followUpEndsOn(SURGERY), "2026-08-23");
  assert.equal(followUpEndsOn("2026-08-05"), "2026-09-04");
});

Deno.test("closes on POD 30, not before", () => {
  assert.deepEqual(patientsToClose([active()], at(FOLLOWUP_DAYS - 1)), []);
  assert.deepEqual(patientsToClose([active()], at(FOLLOWUP_DAYS)), [
    { study_id: "HSF-001", pod: 30, completed_on: "2026-08-23" },
  ]);
});

Deno.test("still closes a row that is already overdue", () => {
  // The case this exists for: nothing closed HSF-001 and it reached POD 35.
  assert.deepEqual(patientsToClose([active()], at(35)), [
    { study_id: "HSF-001", pod: 35, completed_on: "2026-08-23" },
  ]);
});

Deno.test("completed_on is the endpoint date, never the run date", () => {
  const [plan] = patientsToClose([active()], at(42));
  assert.equal(plan.completed_on, followUpEndsOn(SURGERY));
  assert.notEqual(plan.completed_on, at(42));
});

Deno.test("re-running is a no-op — already closed rows are skipped", () => {
  for (const status of [STUDY_STATUS.COMPLETED, STUDY_STATUS.WITHDRAWN]) {
    assert.deepEqual(patientsToClose([active({ study_status: status })], at(35)), []);
  }
});

Deno.test("rows with no surgery date are left alone", () => {
  assert.deepEqual(patientsToClose([active({ surgery_date: null })], at(35)), []);
});

Deno.test("TEST- rows are never closed", () => {
  assert.deepEqual(patientsToClose([active({ study_id: "TEST-001" })], at(35)), []);
});

Deno.test("picks only the due rows out of a mixed cohort", () => {
  const cohort = [
    active({ study_id: "HSF-001" }), // POD 35 — due
    active({ study_id: "WCC-001", surgery_date: "2026-08-05" }), // POD 23
    active({ study_id: "FIH-003", surgery_date: "2026-08-28" }), // POD 0
    active({ study_id: "TEST-001" }),
  ];
  assert.deepEqual(
    patientsToClose(cohort, "2026-08-28").map((p) => p.study_id),
    ["HSF-001"],
  );
});
