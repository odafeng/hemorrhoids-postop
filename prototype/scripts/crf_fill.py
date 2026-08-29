#!/usr/bin/env python3
"""把研究人員 Dashboard 的完整備份填進 CRF 工作簿的可推導欄位。

資料庫是 source of truth；CRF 只承載資料庫生不出來的東西——簽名、納排條件、
補助費簽收、臨床判讀。某一欄是不是自動欄，看它有沒有出現在 SHEETS[...]['auto'] 裡；
沒出現的欄位這支腳本一個字都不會寫。

決策背景見 docs/adr/0002-crf-derived-from-db-export.md，
欄位分類見 docs/superpowers/specs/2026-08-29-crf-export-design.md。

用法：
    /usr/local/bin/python3 crf_fill.py [full_backup_YYYY-MM-DD.json]

不給路徑時取 ~/Downloads 裡最新的一份。這支腳本不連資料庫，也不需要金鑰。
"""
import json
import shutil
import sys
from copy import copy
from datetime import date, datetime
from pathlib import Path

import openpyxl

CRF_PATH = Path(__file__).resolve().parents[2] / '收案文件' / '個案報告表_CRF紀錄.xlsx'
TEST_PREFIX = 'TEST-'


class CrfError(Exception):
    """中止用。訊息會直接印給操作者看，所以寫人話。"""


def norm_date(value):
    """ISO 字串、datetime、date 一律正規化成 YYYY-MM-DD。

    對位鍵的兩端格式不同：JSON 給字串，Excel 給 datetime。不先攤平的話
    每次執行都會判定成新列，一路往下疊重複資料。
    """
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)[:10]


def load_backup(path=None, search_dir=None):
    if path:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    search_dir = search_dir or Path.home() / 'Downloads'
    candidates = sorted(search_dir.glob('full_backup_*.json'),
                        key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise CrfError(
            f'在 {search_dir} 找不到 full_backup_*.json。\n'
            '請先到研究人員 Dashboard 按「完整備份」下載一份。'
        )
    return json.loads(candidates[0].read_text(encoding='utf-8'))


def check_coverage(backup):
    """回傳缺手術記錄的 study_id。

    surgical_records 的 RLS 是 researcher_read_own_surgeon：非 PI 帳號只讀得到
    自己主刀的列，其餘不會報錯、只是不在備份裡。那些列填進 CRF 就是一片空白，
    看不出來是漏抓還是本來就沒有，所以寧可整支中止。
    """
    subjects = {p['study_id'] for p in backup.get('patients', [])
                if not p['study_id'].startswith(TEST_PREFIX)}
    have = {r['study_id'] for r in backup.get('surgical_records', [])}
    return sorted(subjects - have)


def header_map(ws, header_row):
    return {cell.value: cell.column
            for cell in ws[header_row] if cell.value is not None}


def backup_workbook(path):
    dest = path.with_name(f"{path.stem}.bak-{datetime.now():%Y%m%d}{path.suffix}")
    shutil.copy2(path, dest)
    return dest


def _is_date_column(name):
    return '日期' in name or '時間' in name


def _row_key(ws, row, idx, key_cols):
    return tuple(
        norm_date(ws.cell(row=row, column=idx[name]).value) if _is_date_column(name)
        else ws.cell(row=row, column=idx[name]).value
        for name in key_cols
    )


def _first_blank_row(ws, header_row, idx, key_cols):
    col = idx[key_cols[0]]
    row = header_row + 1
    while ws.cell(row=row, column=col).value not in (None, ''):
        row += 1
    return row


def upsert_sheet(ws, header_row, key_cols, records, auto_map):
    """把 records 寫進 ws：auto_map 裡的欄位覆寫，其餘一律不動。

    對位靠 key_cols 組成的鍵，不靠列號。列序會因為補進較早日期的資料而改變，
    照列號寫會把手填的備註接到別人的資料上——而那種錯不會有任何一端報錯。
    """
    idx = header_map(ws, header_row)
    missing = [c for c in list(key_cols) + list(auto_map) if c not in idx]
    if missing:
        raise CrfError(f'「{ws.title}」找不到欄位：{"、".join(missing)}')

    existing = {}
    for row in range(header_row + 1, ws.max_row + 1):
        key = _row_key(ws, row, idx, key_cols)
        if key[0] not in (None, ''):
            existing[key] = row

    written = 0
    for rec in records:
        key = tuple(
            norm_date(auto_map[name](rec)) if _is_date_column(name) else auto_map[name](rec)
            for name in key_cols
        )
        row = existing.get(key)
        if row is None:
            row = _first_blank_row(ws, header_row, idx, key_cols)
            if row > header_row + 1:
                # 整列複製樣式。只設 font 會漏掉 alignment / border / fill，
                # 新列就停在空白列的「待填」外觀（研究日誌/2026-08-13.yaml）。
                for col in range(1, ws.max_column + 1):
                    ws.cell(row=row, column=col)._style = copy(
                        ws.cell(row=row - 1, column=col)._style)
            existing[key] = row
        for name, fn in auto_map.items():
            ws.cell(row=row, column=idx[name]).value = fn(rec)
        written += 1
    return written
