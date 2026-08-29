"""crf_fill 的單元測試。

不在 CI 裡（ci.yml 不裝 openpyxl），手動執行：
    cd prototype/scripts && /usr/local/bin/python3 -m unittest test_crf_fill -v

系統的 /usr/bin/python3 沒有 openpyxl，要用 /usr/local/bin/python3。
"""
import json
import os
import pathlib
import tempfile
import unittest
from datetime import date, datetime

import openpyxl

import crf_fill


class TestNormDate(unittest.TestCase):
    """對位鍵一邊來自 JSON（字串）、一邊來自 Excel（datetime）。
    不正規化就永遠對不上，每次執行都會新增一份重複列。"""

    def test_accepts_iso_string_with_time(self):
        self.assertEqual(crf_fill.norm_date('2026-08-11T09:30:00+00:00'), '2026-08-11')

    def test_accepts_plain_date_string(self):
        self.assertEqual(crf_fill.norm_date('2026-08-11'), '2026-08-11')

    def test_accepts_excel_datetime(self):
        self.assertEqual(crf_fill.norm_date(datetime(2026, 8, 11, 0, 0)), '2026-08-11')

    def test_accepts_date(self):
        self.assertEqual(crf_fill.norm_date(date(2026, 8, 11)), '2026-08-11')

    def test_blank_is_none(self):
        self.assertIsNone(crf_fill.norm_date(None))
        self.assertIsNone(crf_fill.norm_date(''))


class TestCoverage(unittest.TestCase):
    def _backup(self, patients, surgical):
        return {'patients': patients, 'surgical_records': surgical}

    def test_all_covered_returns_empty(self):
        b = self._backup(
            [{'study_id': 'AAA-001'}, {'study_id': 'AAA-002'}],
            [{'study_id': 'AAA-001'}, {'study_id': 'AAA-002'}],
        )
        self.assertEqual(crf_fill.check_coverage(b), [])

    def test_missing_surgical_record_is_reported(self):
        b = self._backup(
            [{'study_id': 'AAA-001'}, {'study_id': 'AAA-002'}],
            [{'study_id': 'AAA-001'}],
        )
        self.assertEqual(crf_fill.check_coverage(b), ['AAA-002'])

    def test_test_account_is_exempt(self):
        b = self._backup(
            [{'study_id': 'TEST-001'}, {'study_id': 'AAA-001'}],
            [{'study_id': 'AAA-001'}],
        )
        self.assertEqual(crf_fill.check_coverage(b), [])


class TestHeaderMap(unittest.TestCase):
    def test_maps_names_to_one_based_columns(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws['A4'], ws['B4'], ws['C4'] = 'Study ID', '收案日期', '年齡'
        self.assertEqual(crf_fill.header_map(ws, 4),
                         {'Study ID': 1, '收案日期': 2, '年齡': 3})


class TestLoadBackup(unittest.TestCase):
    def test_picks_newest_when_no_path_given(self):
        with tempfile.TemporaryDirectory() as d:
            old = pathlib.Path(d) / 'full_backup_2026-08-01.json'
            new = pathlib.Path(d) / 'full_backup_2026-08-29.json'
            old.write_text(json.dumps({'patients': [{'study_id': 'OLD'}]}))
            new.write_text(json.dumps({'patients': [{'study_id': 'NEW'}]}))
            os.utime(old, (1, 1))
            got = crf_fill.load_backup(search_dir=pathlib.Path(d))
            self.assertEqual(got['patients'][0]['study_id'], 'NEW')

    def test_no_backup_found_raises(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(crf_fill.CrfError):
                crf_fill.load_backup(search_dir=pathlib.Path(d))


class TestBackupWorkbook(unittest.TestCase):
    def test_snapshot_keeps_the_gitignored_prefix(self):
        with tempfile.TemporaryDirectory() as d:
            src = pathlib.Path(d) / '個案報告表_CRF紀錄.xlsx'
            openpyxl.Workbook().save(src)
            dest = crf_fill.backup_workbook(src)
            self.assertTrue(dest.exists())
            # .gitignore:40 的 glob 是 收案文件/個案報告表*.xlsx
            self.assertTrue(dest.name.startswith('個案報告表'))
            self.assertTrue(dest.name.endswith('.xlsx'))


if __name__ == '__main__':
    unittest.main()
