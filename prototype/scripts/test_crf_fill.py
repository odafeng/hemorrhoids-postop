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


class TestUpsert(unittest.TestCase):
    AUTO = {
        'Study ID': lambda r: r['study_id'],
        '回報日期': lambda r: crf_fill.norm_date(r['report_date']),
        '疼痛 NRS': lambda r: r['pain_nrs'],
    }
    KEY = ('Study ID', '回報日期')

    def _sheet(self):
        wb = openpyxl.Workbook()
        ws = wb.active
        for col, name in enumerate(['Study ID', '回報日期', '疼痛 NRS', '備註'], start=1):
            ws.cell(row=5, column=col).value = name
        return ws

    def test_inserts_new_rows(self):
        ws = self._sheet()
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-11', 'pain_nrs': 3},
        ], self.AUTO)
        self.assertEqual(ws.cell(row=6, column=1).value, 'AAA-001')
        self.assertEqual(ws.cell(row=6, column=3).value, 3)

    def test_manual_column_survives_rerun(self):
        ws = self._sheet()
        rec = {'study_id': 'AAA-001', 'report_date': '2026-08-11', 'pain_nrs': 3}
        crf_fill.upsert_sheet(ws, 5, self.KEY, [rec], self.AUTO)
        ws.cell(row=6, column=4).value = '主持人判讀為傷口分泌物'
        rec['pain_nrs'] = 5
        crf_fill.upsert_sheet(ws, 5, self.KEY, [rec], self.AUTO)
        self.assertEqual(ws.cell(row=6, column=3).value, 5)
        self.assertEqual(ws.cell(row=6, column=4).value, '主持人判讀為傷口分泌物')

    def test_manual_column_follows_its_own_row_when_order_changes(self):
        """靠列號對位的實作在前兩個測試也會過，只有這裡會現形：
        插入一筆較早的日期讓列序改變，手填備註不能接到別人身上。"""
        ws = self._sheet()
        later = {'study_id': 'AAA-001', 'report_date': '2026-08-11', 'pain_nrs': 3}
        crf_fill.upsert_sheet(ws, 5, self.KEY, [later], self.AUTO)
        ws.cell(row=6, column=4).value = '屬於 08-11 的備註'

        earlier = {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 7}
        crf_fill.upsert_sheet(ws, 5, self.KEY, [earlier, later], self.AUTO)

        rows = {crf_fill.norm_date(ws.cell(row=r, column=2).value): r for r in (6, 7)}
        self.assertEqual(ws.cell(row=rows['2026-08-11'], column=4).value, '屬於 08-11 的備註')
        self.assertIsNone(ws.cell(row=rows['2026-08-09'], column=4).value)

    def test_excel_datetime_key_matches_json_string(self):
        ws = self._sheet()
        ws.cell(row=6, column=1).value = 'AAA-001'
        ws.cell(row=6, column=2).value = datetime(2026, 8, 11)
        ws.cell(row=6, column=4).value = '既有備註'
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-11T00:00:00+00:00', 'pain_nrs': 9},
        ], self.AUTO)
        self.assertIsNone(ws.cell(row=7, column=1).value)  # 沒有新增重複列
        self.assertEqual(ws.cell(row=6, column=3).value, 9)
        self.assertEqual(ws.cell(row=6, column=4).value, '既有備註')

    def test_new_row_copies_style_from_previous_row(self):
        ws = self._sheet()
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 1},
        ], self.AUTO)
        ws.cell(row=6, column=1).font = openpyxl.styles.Font(bold=True, size=13)
        crf_fill.upsert_sheet(ws, 5, self.KEY, [
            {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 1},
            {'study_id': 'AAA-002', 'report_date': '2026-08-09', 'pain_nrs': 2},
        ], self.AUTO)
        self.assertTrue(ws.cell(row=7, column=1).font.bold)
        self.assertEqual(ws.cell(row=7, column=1).font.size, 13)

    def test_missing_column_aborts(self):
        ws = self._sheet()
        with self.assertRaises(crf_fill.CrfError):
            crf_fill.upsert_sheet(ws, 5, self.KEY, [
                {'study_id': 'AAA-001', 'report_date': '2026-08-09', 'pain_nrs': 1},
            ], {**self.AUTO, '不存在的欄位': lambda r: 1})


if __name__ == '__main__':
    unittest.main()
