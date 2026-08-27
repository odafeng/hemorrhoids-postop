#!/usr/bin/env python3
"""
dashboard.py 的 compute() 單元測試。

  pip install requests matplotlib numpy
  python3 -m unittest discover -s scripts -p 'test_*.py'

用 stdlib unittest，不引入 pytest——這支腳本本身已需要 requests/numpy/matplotlib，
不值得為一個本機維運腳本再多一個測試依賴。
"""

import os
import unittest
from datetime import date, timedelta

# dashboard.py 在 module 層執行 _load_key()，找不到金鑰會 SystemExit(1)，
# 於是連 import 都做不到。這裡塞一個假值讓它過關——compute() 不發任何請求，
# 金鑰不會被用到。setdefault 保留真實環境變數，避免蓋掉開發者已設的值。
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key-not-used-by-compute")

import dashboard  # noqa: E402  （必須在設好環境變數之後）


def _data(patients, reports):
    return {
        "patients": patients,
        "symptom_reports": reports,
        "ai_chat_logs": [],
        "alerts": [],
    }


def _patient(sid, days_post_op=3, **kw):
    sd = (date.today() - timedelta(days=days_post_op)).isoformat()
    return {"study_id": sid, "surgery_date": sd, **kw}


class ActivationRate(unittest.TestCase):
    """啟用改以「至少回報過一次症狀」認定，不再讀 patients.app_activated。"""

    def test_patient_with_a_report_counts_as_activated(self):
        m = dashboard.compute(_data(
            [_patient("AAA-001")],
            [{"study_id": "AAA-001", "pod": 1}],
        ))
        self.assertEqual(m["act_rate"], 1.0)

    def test_patient_with_no_report_counts_as_not_activated(self):
        m = dashboard.compute(_data([_patient("AAA-001")], []))
        self.assertEqual(m["act_rate"], 0.0)

    def test_rate_is_the_fraction_of_patients_with_at_least_one_report(self):
        m = dashboard.compute(_data(
            [_patient("AAA-001"), _patient("AAA-002"), _patient("AAA-003"),
             _patient("AAA-004")],
            [{"study_id": "AAA-001"}, {"study_id": "AAA-001"},  # 同一人多筆只算一次
             {"study_id": "AAA-002"}],
        ))
        self.assertEqual(m["act_rate"], 0.5)

    def test_stale_app_activated_field_is_ignored(self):
        """這是本次改動的重點：欄位恆為 false，不該再影響結果。"""
        m = dashboard.compute(_data(
            [_patient("AAA-001", app_activated=False)],
            [{"study_id": "AAA-001"}],
        ))
        self.assertEqual(m["act_rate"], 1.0, "app_activated=False 不該蓋掉已回報的事實")

        m = dashboard.compute(_data(
            [_patient("AAA-001", app_activated=True)],
            [],
        ))
        self.assertEqual(m["act_rate"], 0.0, "app_activated=True 不該假造未回報者的啟用")

    def test_report_from_an_unknown_study_id_does_not_inflate_the_rate(self):
        """TEST-001 或已退出者的回報不該讓分子超過分母。"""
        m = dashboard.compute(_data(
            [_patient("AAA-001")],
            [{"study_id": "AAA-001"}, {"study_id": "TEST-001"}],
        ))
        self.assertEqual(m["act_rate"], 1.0)

    def test_no_patients_yields_zero_not_a_division_error(self):
        m = dashboard.compute(_data([], []))
        self.assertEqual(m["act_rate"], 0)

    def test_activated_set_is_exposed_for_the_patient_table(self):
        """render 階段的 ✅/❌ 欄直接讀 m['activated']，不重掃 reports。"""
        m = dashboard.compute(_data(
            [_patient("AAA-001"), _patient("AAA-002")],
            [{"study_id": "AAA-002"}],
        ))
        self.assertIn("AAA-002", m["activated"])
        self.assertNotIn("AAA-001", m["activated"])


if __name__ == "__main__":
    unittest.main()
