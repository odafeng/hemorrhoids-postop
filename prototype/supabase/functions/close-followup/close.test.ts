// Run: deno test supabase/functions/close-followup/close.test.ts
import assert from "node:assert/strict";
import { closeFollowUp, completedAtFor } from "./close.ts";
import { STUDY_STATUS } from "../_shared/followup.ts";

const TODAY = "2026-08-28";
const row = (study_id: string, surgery_date: string | null, status: string = STUDY_STATUS.ACTIVE) =>
  ({ study_id, surgery_date, study_status: status });

const deps = (patients: ReturnType<typeof row>[], failOn: string[] = []) => {
  const writes: { studyId: string; completedAt: string }[] = [];
  return {
    writes,
    listPatients: () => Promise.resolve({ patients, error: null }),
    markCompleted: (studyId: string, completedAt: string) => {
      if (failOn.includes(studyId)) return Promise.resolve({ error: { message: "RLS denied" } });
      writes.push({ studyId, completedAt });
      return Promise.resolve({ error: null });
    },
  };
};

Deno.test("completedAtFor stamps Taipei midnight of the endpoint day", () => {
  assert.equal(completedAtFor("2026-08-23"), "2026-08-23T00:00:00+08:00");
});

Deno.test("closes the overdue row and leaves the rest alone", async () => {
  // The real cohort on 2026-08-28: HSF-001 at POD 35, WCC at 23, FIH-003 at 0.
  const d = deps([
    row("HSF-001", "2026-07-24"),
    row("WCC-001", "2026-08-05"),
    row("FIH-003", "2026-08-28"),
  ]);
  const res = await closeFollowUp(TODAY, d);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.closed, [
    { study_id: "HSF-001", pod: 35, completed_at: "2026-08-23T00:00:00+08:00" },
  ]);
  assert.deepEqual(d.writes, [
    { studyId: "HSF-001", completedAt: "2026-08-23T00:00:00+08:00" },
  ]);
});

Deno.test("writes nothing when nobody is due", async () => {
  const d = deps([row("WCC-001", "2026-08-05"), row("FIH-003", "2026-08-28")]);
  const res = await closeFollowUp(TODAY, d);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.closed, []);
  assert.deepEqual(d.writes, []);
});

Deno.test("a second run writes nothing — already-closed rows are skipped", async () => {
  const d = deps([row("HSF-001", "2026-07-24", STUDY_STATUS.COMPLETED)]);
  const res = await closeFollowUp(TODAY, d);
  assert.equal(res.status, 200);
  assert.deepEqual(d.writes, []);
});

Deno.test("one failed write does not stop the others, and the run reports 500", async () => {
  const d = deps(
    [row("HSF-001", "2026-07-24"), row("HSF-002", "2026-07-01")],
    ["HSF-001"],
  );
  const res = await closeFollowUp(TODAY, d);
  assert.equal(res.status, 500, "a silent 200 would hide the failure from the cron");
  assert.deepEqual(res.body.failed, [{ study_id: "HSF-001", error: "RLS denied" }]);
  assert.deepEqual(res.body.closed?.map((c) => c.study_id), ["HSF-002"]);
  assert.deepEqual(d.writes.map((w) => w.studyId), ["HSF-002"]);
});

Deno.test("a failed read is reported, not treated as an empty cohort", async () => {
  const res = await closeFollowUp(TODAY, {
    listPatients: () => Promise.resolve({ patients: null, error: { message: "timeout" } }),
    markCompleted: () => Promise.reject(new Error("must not be called")),
  });

  assert.equal(res.status, 500);
  assert.equal(res.body.error, "timeout");
});
