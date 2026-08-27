#!/usr/bin/env python3
"""
Hemorrhoids_PostOp 研究進度 Dashboard
======================================
Setup:
  pip install requests matplotlib numpy
  sudo apt install -y fonts-noto-cjk   # WSL/Linux

  # Create .env file (NOT committed to git):
  echo 'SUPABASE_SERVICE_KEY=your_key_here' > .env

  python3 dashboard.py
"""

import os, platform
from datetime import datetime, date
from collections import Counter, defaultdict
from pathlib import Path

import requests
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
import matplotlib.font_manager as fm

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG — key loaded from environment or .env file, NEVER hardcoded
# ═══════════════════════════════════════════════════════════════════════════
SUPABASE_URL = "https://krohucxzthnukbuzfwiu.supabase.co/rest/v1"

def _load_key():
    """Load service_role key from env var or .env file."""
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if key:
        return key
    # Try .env file in same directory
    env_file = Path(__file__).parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("SUPABASE_SERVICE_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    # Try home directory
    home_env = Path.home() / ".hemorrhoids_postop_env"
    if home_env.exists():
        return home_env.read_text().strip()
    print("❌ SUPABASE_SERVICE_KEY not found!")
    print("   Set it via one of:")
    print("   1. export SUPABASE_SERVICE_KEY=your_key")
    print("   2. Create .env file: echo 'SUPABASE_SERVICE_KEY=your_key' > .env")
    print("   3. Create ~/.hemorrhoids_postop_env with just the key")
    raise SystemExit(1)

SUPABASE_KEY = _load_key()

OUTPUT_DIR = Path("output")
OUTPUT_DIR.mkdir(exist_ok=True)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

# ═══════════════════════════════════════════════════════════════════════════
# FONT SETUP
# ═══════════════════════════════════════════════════════════════════════════
def find_cjk_font():
    candidates = [
        "Noto Sans CJK TC", "Noto Sans CJK SC", "Noto Sans CJK JP",
        "Noto Sans TC", "PingFang TC", "PingFang SC",
        "Microsoft JhengHei", "Microsoft YaHei",
        "WenQuanYi Micro Hei",
    ]
    available = {f.name for f in fm.fontManager.ttflist}
    for c in candidates:
        if c in available:
            return c
    for f in fm.fontManager.ttflist:
        if "CJK" in f.name or "Noto" in f.name:
            return f.name
    return None

fm._load_fontmanager(try_read_cache=False)
CJK_FONT = find_cjk_font()
if CJK_FONT:
    print(f"🔤 CJK font: {CJK_FONT}")
    plt.rcParams["font.family"] = [CJK_FONT, "DejaVu Sans", "sans-serif"]
else:
    print("⚠️  No CJK font! Run: sudo apt install -y fonts-noto-cjk")
    plt.rcParams["font.family"] = ["DejaVu Sans", "sans-serif"]

plt.rcParams.update({
    "font.size": 10, "axes.titlesize": 12, "axes.labelsize": 11,
    "xtick.labelsize": 9, "ytick.labelsize": 9, "legend.fontsize": 9,
    "figure.dpi": 300, "savefig.dpi": 300, "savefig.bbox": "tight",
    "savefig.pad_inches": 0.15, "axes.spines.top": False, "axes.spines.right": False,
    "axes.unicode_minus": False,
})

TEAL, BLUE, RED, AMBER, GREEN, PURPLE, GRAY = "#0d9488", "#3b82f6", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6", "#94a3b8"

# ═══════════════════════════════════════════════════════════════════════════
# SUPABASE
# ═══════════════════════════════════════════════════════════════════════════
def sb(table, params=""):
    url = f"{SUPABASE_URL}/{table}?{params}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  ⚠️  {table}: {e}")
        return []

def fetch_all():
    print("📡 連線 Supabase...")
    tables = {
        "patients":              "order=created_at.asc",
        "symptom_reports":       "order=report_date.asc",
        "ai_chat_logs":          "order=created_at.asc",
        "alerts":                "order=triggered_at.desc",
        "ai_request_logs":       "order=created_at.asc",
        "pending_notifications": "",
        "usability_surveys":     "",
        "healthcare_utilization":"",
    }
    data = {}
    for t, p in tables.items():
        print(f"  → {t}...", end=" ")
        rows = sb(t, p)
        data[t] = rows
        print(f"{len(rows)} 筆")
    return data

# ═══════════════════════════════════════════════════════════════════════════
# METRICS
# ═══════════════════════════════════════════════════════════════════════════
def days_between(a, b):
    try:
        return max(0, (datetime.fromisoformat(b[:10]).date() - datetime.fromisoformat(a[:10]).date()).days)
    except:
        return 0

def compute(data):
    patients = data["patients"]
    reports  = data["symptom_reports"]
    chats    = data["ai_chat_logs"]
    alerts   = data["alerts"]
    today    = date.today().isoformat()
    n        = len(patients)
    m        = {"n": n}

    dates = sorted(filter(None, [(p.get("surgery_date") or p.get("created_at",""))[:10] for p in patients]))
    cum = 0; m["enroll_tl"] = []
    for d in dates:
        cum += 1; m["enroll_tl"].append({"date": d, "cum": cum})

    adh = []
    for p in patients:
        sid = p.get("study_id",""); sd = (p.get("surgery_date") or p.get("created_at",""))[:10]
        if not sd: adh.append({"sid":sid,"exp":0,"act":0,"rate":0}); continue
        d = min(days_between(sd, today), 30)
        exp = min(d+1, 8)
        if d > 7:  exp += min((d-7)//2, 4)
        if d > 14: exp += min(-(-((d-14))//7), 3)
        act = sum(1 for r in reports if r.get("study_id")==sid)
        adh.append({"sid":sid,"exp":exp,"act":act,"rate":act/exp if exp>0 else 0})
    m["adh"] = adh
    m["avg_adh"] = sum(a["rate"] for a in adh)/len(adh) if adh else 0

    # patients.app_activated 從未被任何程式寫入，恆為 false（2026-08-12 決議不使用）。
    # 啟用改以「至少回報過一次症狀」認定。
    m["activated"] = {r.get("study_id") for r in reports}
    activated = sum(1 for p in patients if p.get("study_id") in m["activated"])
    m["act_rate"] = activated/n if n else 0
    m["pod7_ok"] = sum(1 for a in adh if sum(1 for r in reports if r.get("study_id")==a["sid"] and (r.get("pod") or 99)<=7)>=5)

    by_pod = defaultdict(lambda: {"pains":[],"fever":0,"n":0})
    bleed_c, bowel_c, wound_c = Counter(), Counter(), Counter()
    for r in reports:
        pod = r.get("pod","?"); by_pod[pod]["n"] += 1
        ps = r.get("pain_nrs")
        if ps is not None:
            try: by_pod[pod]["pains"].append(int(ps))
            except: pass
        if r.get("fever"): by_pod[pod]["fever"] += 1
        bleed_c[r.get("bleeding") or "none"] += 1
        bowel_c[r.get("bowel") or "normal"] += 1
        wound_c[r.get("wound") or "normal"] += 1

    m["sym_tl"] = []
    for pod in sorted(by_pod.keys(), key=lambda x: int(x) if str(x).isdigit() else 999):
        s = by_pod[pod]; e = {"pod":pod,"n":s["n"],"fever":s["fever"]}
        if s["pains"]:
            e["avg"]=round(np.mean(s["pains"]),1); e["max"]=int(max(s["pains"])); e["min"]=int(min(s["pains"]))
        m["sym_tl"].append(e)
    m["bleed_d"]=dict(bleed_c); m["bowel_d"]=dict(bowel_c); m["wound_d"]=dict(wound_c)

    m["n_chats"]=len(chats); m["reviewed"]=sum(1 for c in chats if c.get("reviewed"))
    m["rev_rate"]=m["reviewed"]/m["n_chats"] if m["n_chats"] else 0
    m["topic_d"]=dict(Counter(c.get("matched_topic") or "未分類" for c in chats).most_common())
    rev={"correct":0,"incorrect":0,"pending":0}
    for c in chats:
        if not c.get("reviewed"): rev["pending"]+=1
        elif c.get("review_result")=="correct": rev["correct"]+=1
        else: rev["incorrect"]+=1
    m["rev_res"]=rev; m["avg_chat"]=m["n_chats"]/n if n else 0

    ai_reqs=data.get("ai_request_logs",[])
    m["in_tok"]=sum(r.get("input_tokens") or 0 for r in ai_reqs)
    m["out_tok"]=sum(r.get("output_tokens") or 0 for r in ai_reqs)
    m["avg_lat"]=round(np.mean([r.get("latency_ms") or 0 for r in ai_reqs]),0) if ai_reqs else 0

    m["n_alerts"]=len(alerts)
    m["alert_types"]=dict(Counter(a.get("alert_type","unknown") for a in alerts))
    m["n_notifs"]=len(data.get("pending_notifications",[])); m["n_surveys"]=len(data.get("usability_surveys",[]))
    m["n_hcu"]=len(data.get("healthcare_utilization",[]))

    m["reports"]=reports; m["chats"]=chats; m["alerts_r"]=alerts; m["patients"]=patients; m["ai_reqs"]=ai_reqs
    return m

# ═══════════════════════════════════════════════════════════════════════════
# FIGURES
# ═══════════════════════════════════════════════════════════════════════════
def fig_enrollment(m):
    tl = m["enroll_tl"]
    if not tl: return print("  ⏭️  無收案資料")
    fig, ax = plt.subplots(figsize=(6,3.5))
    dates, cums = [t["date"] for t in tl], [t["cum"] for t in tl]
    ax.fill_between(range(len(dates)), cums, alpha=0.15, color=TEAL)
    ax.plot(range(len(dates)), cums, "-o", color=TEAL, ms=5, lw=2)
    ax.axhline(30, color=AMBER, ls="--", lw=1, label="目標下限 (n=30)")
    ax.axhline(50, color=GREEN, ls="--", lw=1, label="目標上限 (n=50)")
    ax.set_xticks(range(len(dates))); ax.set_xticklabels(dates, rotation=45, ha="right")
    ax.set_xlabel("日期"); ax.set_ylabel("累計收案數")
    ax.set_title("收案進度"); ax.legend(loc="lower right"); ax.set_ylim(bottom=0)
    fig.tight_layout(); fig.savefig(OUTPUT_DIR/"fig_enrollment.png"); plt.close(fig)
    print("  ✅ fig_enrollment.png")

def fig_pain(m):
    tl = [t for t in m["sym_tl"] if "avg" in t]
    if not tl: return print("  ⏭️  無疼痛資料")
    fig, ax = plt.subplots(figsize=(6,3.5))
    pods = [f"POD {t['pod']}" for t in tl]
    avgs, maxs, mins = [t["avg"] for t in tl], [t["max"] for t in tl], [t["min"] for t in tl]
    x = range(len(pods))
    ax.fill_between(x, mins, maxs, alpha=0.12, color=TEAL, label="範圍 (min–max)")
    ax.plot(x, avgs, "-o", color=TEAL, ms=6, lw=2, label="平均 NRS", zorder=5)
    ax.plot(x, maxs, "--", color=RED, lw=1, alpha=0.6, label="最大值")
    ax.plot(x, mins, "--", color=GREEN, lw=1, alpha=0.6, label="最小值")
    ax.set_xticks(x); ax.set_xticklabels(pods, rotation=45, ha="right")
    ax.set_xlabel("術後天數"); ax.set_ylabel("疼痛分數 (NRS 0–10)")
    ax.set_title("痔瘡術後疼痛變化趨勢")
    ax.set_ylim(0, 10.5); ax.legend(loc="upper right")
    fig.tight_layout(); fig.savefig(OUTPUT_DIR/"fig_pain_trajectory.png"); plt.close(fig)
    print("  ✅ fig_pain_trajectory.png")

def fig_adherence(m):
    adh = m["adh"]
    if not adh: return print("  ⏭️  無 adherence 資料")
    fig, ax = plt.subplots(figsize=(6, max(2, len(adh)*0.5+1)))
    sids = [a["sid"] or f"Pt {i+1}" for i,a in enumerate(adh)]
    rates = [a["rate"]*100 for a in adh]
    colors = [GREEN if r>=70 else AMBER if r>=40 else RED for r in rates]
    ax.barh(range(len(sids)), rates, color=colors, height=0.6, edgecolor="white", lw=0.5)
    ax.axvline(70, color=GRAY, ls="--", lw=1, label="目標 (≥70%)")
    for i,r in enumerate(rates): ax.text(r+1.5, i, f"{r:.0f}%", va="center", fontsize=9)
    ax.set_yticks(range(len(sids))); ax.set_yticklabels(sids, fontfamily="monospace", fontsize=9)
    ax.set_xlabel("問卷完成率 (%)"); ax.set_title("個別病人問卷依從性")
    ax.set_xlim(0, 110); ax.legend(loc="lower right"); ax.invert_yaxis()
    fig.tight_layout(); fig.savefig(OUTPUT_DIR/"fig_adherence.png"); plt.close(fig)
    print("  ✅ fig_adherence.png")

def fig_symptoms(m):
    bd, bw = m["bleed_d"], m["bowel_d"]
    if not bd and not bw: return print("  ⏭️  無症狀分布資料")
    fig, axes = plt.subplots(1, 2, figsize=(8, 3.5))
    pals = [[TEAL,BLUE,AMBER,RED,PURPLE,GREEN],[GREEN,AMBER,RED,BLUE,PURPLE]]
    for ax, dist, pal, title in [(axes[0],bd,pals[0],"出血嚴重度"), (axes[1],bw,pals[1],"排便狀況")]:
        if dist:
            labels, vals = zip(*dist.items())
            ax.pie(vals, labels=labels, colors=pal[:len(labels)], autopct="%1.0f%%",
                   startangle=90, pctdistance=0.75, wedgeprops={"edgecolor":"white","linewidth":1.5})
        ax.set_title(title)
    fig.suptitle("所有回報之症狀分布", fontsize=12, y=1.02)
    fig.tight_layout(); fig.savefig(OUTPUT_DIR/"fig_symptoms.png"); plt.close(fig)
    print("  ✅ fig_symptoms.png")

def fig_ai_topics(m):
    td = m["topic_d"]
    if not td: return print("  ⏭️  無 AI 主題資料")
    fig, ax = plt.subplots(figsize=(6, max(2.5, len(td)*0.45+1)))
    topics, counts = list(td.keys()), list(td.values())
    ax.barh(range(len(topics)), counts, color=PURPLE, height=0.6, edgecolor="white")
    ax.set_yticks(range(len(topics))); ax.set_yticklabels(topics, fontsize=9)
    ax.set_xlabel("提問次數"); ax.set_title("AI 衛教問答 — 主題分布")
    for i,c in enumerate(counts): ax.text(c+0.3, i, str(c), va="center", fontsize=9)
    ax.invert_yaxis()
    fig.tight_layout(); fig.savefig(OUTPUT_DIR/"fig_ai_topics.png"); plt.close(fig)
    print("  ✅ fig_ai_topics.png")

def fig_feasibility(m):
    fig, ax = plt.subplots(figsize=(7, 3.5))
    metrics = [
        ("收案數\n(n)", m["n"], 50, 30, TEAL),
        ("App\n啟用率 (%)", round(m["act_rate"]*100), 100, 80, BLUE),
        ("問卷\n依從率 (%)", round(m["avg_adh"]*100), 100, 70, PURPLE),
        ("POD0-7\n≥5次回報 (n)", m["pod7_ok"], m["n"] or 1, max(1,round((m["n"] or 1)*0.7)), AMBER),
    ]
    for i,(label,val,mx,thr,color) in enumerate(metrics):
        pv = val/mx*100 if mx else 0
        pt = thr/mx*100 if mx else 0
        ax.bar(i, pv, 0.55, color=color, alpha=0.8, edgecolor="white")
        ax.plot([i-0.3,i+0.3],[pt,pt], color="#333", lw=2, ls="--")
        ax.text(i, pv+2, str(val), ha="center", fontsize=10, fontweight="bold")
    ax.set_xticks(range(len(metrics))); ax.set_xticklabels([m[0] for m in metrics], fontsize=9)
    ax.set_ylabel("達成率 (%)"); ax.set_title("可行性門檻達成狀況")
    ax.set_ylim(0, 115)
    ax.legend(handles=[Line2D([0],[0],color="#333",ls="--",lw=2,label="門檻")], loc="upper right")
    fig.tight_layout(); fig.savefig(OUTPUT_DIR/"fig_feasibility.png"); plt.close(fig)
    print("  ✅ fig_feasibility.png")

# ═══════════════════════════════════════════════════════════════════════════
# HTML
# ═══════════════════════════════════════════════════════════════════════════
def _pbar(label, value, mx, threshold, color):
    ratio = min(value/(mx or 1),1)*100; tp = (threshold/(mx or 1))*100
    met = value >= threshold; vc = "#22c55e" if met else "#f59e0b"
    sfx = "%" if mx<=100 else f" / {mx}"
    return f'''<div class="pb"><div class="pb-h"><span class="dim">{label}</span>
    <span style="color:{vc}" class="mono">{value}{sfx} (≥{threshold})</span></div>
    <div class="pb-t"><div class="pb-f" style="width:{ratio:.0f}%;background:{color if met else "#f59e0b"}"></div>
    <div class="pb-m" style="left:{tp:.0f}%"></div></div></div>'''

def gen_html(m):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    rrows = ""
    for r in reversed(m["reports"][-30:]):
        ps = r.get("pain_nrs"); pc = "#ef4444" if (ps or 0)>=8 else "#f59e0b" if (ps or 0)>=5 else "#22c55e"
        fv = "🌡️ 是" if r.get("fever") else "否"
        rrows += f'''<tr><td class="tc">{r.get("study_id","—")}</td><td>{r.get("pod","—")}</td>
        <td class="dim">{r.get("report_date","—")}</td>
        <td style="color:{pc};font-weight:600">{ps if ps is not None else "—"}</td>
        <td>{r.get("bleeding","—")}</td><td>{r.get("bowel","—")}</td>
        <td>{r.get("wound","—")}</td><td>{fv}</td>
        <td>{r.get("urinary","—")}</td><td>{r.get("continence","—")}</td></tr>'''

    crows = ""
    for c in reversed(m["chats"][-30:]):
        rv = "✅" if c.get("reviewed") else "⏳"
        rr = c.get("review_result","—"); rc = "#22c55e" if rr=="correct" else "#ef4444" if rr=="incorrect" else "#64748b"
        crows += f'''<tr><td class="tc">{c.get("study_id","—")}</td>
        <td class="dim">{(c.get("created_at",""))[:16].replace("T"," ")}</td>
        <td title="{c.get("user_message","")}">{(c.get("user_message","—"))[:80]}</td>
        <td><span class="tag">{c.get("matched_topic","—")}</span></td>
        <td>{rv}</td><td style="color:{rc}">{rr}</td></tr>'''

    abars = ""
    for a in m["adh"]:
        rate=a["rate"]*100; col="#22c55e" if rate>=70 else "#f59e0b" if rate>=40 else "#ef4444"
        abars += f'''<div class="ar"><span class="ai">{a["sid"] or "—"}</span>
        <div class="at"><div class="af" style="width:{min(rate,100):.0f}%;background:{col}"></div></div>
        <span class="ap" style="color:{col}">{rate:.1f}%</span></div>'''

    arows = ""
    for a in m["alerts_r"]:
        arows += f'''<div class="alr"><span class="tc mono">{a.get("study_id","—")}</span>
        <span class="dim" style="font-size:11px">{(a.get("triggered_at",""))[:16].replace("T"," ")}</span>
        <span><span class="atag">{a.get("alert_type","?")}</span>
        <span class="dim">[{a.get("alert_level","")}]</span> {a.get("message","")}</span></div>'''

    ptrows = ""
    for p in m["patients"]:
        act = "✅" if p.get("study_id") in m["activated"] else "❌"
        ptrows += f'''<tr><td class="tc">{p.get("study_id","—")}</td>
        <td>{p.get("age") or "—"}</td><td>{p.get("sex") or "—"}</td>
        <td>{p.get("surgery_type") or "—"}</td><td>{p.get("surgery_date","—")}</td>
        <td>{p.get("hemorrhoid_grade") or "—"}</td><td>{act}</td>
        <td>{p.get("study_status","—")}</td></tr>'''

    html = f'''<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Hemorrhoids_PostOp 研究儀表板</title><style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#0a0f1a;color:#e2e8f0;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei','Segoe UI',sans-serif}}
.ctr{{max-width:1100px;margin:0 auto;padding:20px}}
header{{padding:20px;border-bottom:1px solid #1e293b;background:linear-gradient(180deg,#0f172a,#0a0f1a)}}
header h1{{font-family:monospace;font-size:22px;background:linear-gradient(135deg,#14b8a6,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}}
header p{{font-size:12px;color:#64748b;margin-top:4px}}
.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:20px 0}}
.stat{{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:18px 20px;position:relative;overflow:hidden}}
.sl{{font-size:11px;color:#64748b;letter-spacing:1px;text-transform:uppercase;font-family:monospace}}
.sv{{font-size:28px;font-weight:700;font-family:monospace;margin:4px 0 2px}}
.ss{{font-size:12px;color:#475569}}
.sec{{background:#111827;border:1px solid #1e293b;border-radius:12px;padding:22px;margin-bottom:18px}}
.sec h2{{font-size:15px;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:10px}}
.sec h2::before{{content:'';width:4px;height:16px;background:#14b8a6;border-radius:2px;display:inline-block}}
.sub{{font-size:12px;color:#64748b;margin:-10px 0 14px 14px}}
.pb{{margin-bottom:12px}}.pb-h{{display:flex;justify-content:space-between;margin-bottom:3px}}
.pb-t{{height:7px;background:#1e293b;border-radius:4px;overflow:hidden;position:relative}}
.pb-f{{height:100%;border-radius:4px}}.pb-m{{position:absolute;top:-2px;bottom:-2px;width:2px;background:#e2e8f0;opacity:.3}}
table{{width:100%;border-collapse:collapse;font-size:12px;font-family:monospace}}
th{{padding:7px 10px;text-align:left;color:#64748b;font-weight:500;border-bottom:1px solid #1e293b}}
td{{padding:7px 10px;border-bottom:1px solid rgba(30,41,59,.3)}}
.dim{{color:#64748b}}.tc{{color:#14b8a6}}.mono{{font-family:monospace}}
.tag{{background:#1e3a5f;color:#2dd4bf;padding:1px 7px;border-radius:4px;font-size:11px}}
.atag{{background:#991b1b;color:#fca5a5;padding:1px 7px;border-radius:4px;font-size:11px;margin-right:6px}}
.g2{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
.fig{{text-align:center}}.fig img{{max-width:100%;border-radius:8px;background:#fff;padding:8px}}
.ar{{display:grid;grid-template-columns:110px 1fr 65px;align-items:center;gap:8px;padding:5px 8px;background:#0a0f1a;border-radius:5px;margin-bottom:3px}}
.ai{{font-size:12px;font-family:monospace;color:#14b8a6}}
.at{{height:6px;background:#1e293b;border-radius:3px;overflow:hidden}}
.af{{height:100%;border-radius:3px}}.ap{{font-size:12px;font-family:monospace;text-align:right}}
.alr{{display:grid;grid-template-columns:100px 120px 1fr;padding:8px 10px;background:#0a0f1a;border-radius:5px;border-left:3px solid #ef4444;margin-bottom:5px}}
.ok{{text-align:center;padding:40px}}.ok .i{{font-size:44px;margin-bottom:10px}}.ok .t{{font-size:15px;color:#22c55e;font-weight:600}}.ok .d{{font-size:12px;color:#64748b;margin-top:6px}}
footer{{text-align:center;padding:14px;border-top:1px solid #1e293b;font-size:11px;color:#475569;font-family:monospace}}
@media(max-width:768px){{.stats{{grid-template-columns:repeat(2,1fr)}}.g2{{grid-template-columns:1fr}}}}
</style></head><body>
<header><div class="ctr"><h1>Hemorrhoids_PostOp</h1>
<p>研究進度儀表板 — 高雄榮民總醫院 先導可行性研究 · 產出時間 {now}</p></div></header>
<div class="ctr">
<div class="stats">
<div class="stat"><div class="sl">👥 收案數</div><div class="sv" style="color:#14b8a6">{m["n"]}</div><div class="ss">目標：30–50 例</div></div>
<div class="stat"><div class="sl">📋 症狀回報</div><div class="sv" style="color:#3b82f6">{len(m["reports"])}</div><div class="ss">{len(m["sym_tl"])} 個 POD</div></div>
<div class="stat"><div class="sl">💬 AI 問答</div><div class="sv" style="color:#8b5cf6">{m["n_chats"]}</div><div class="ss">平均 {m["avg_chat"]:.1f} 次/病人</div></div>
<div class="stat"><div class="sl">🚨 警示</div><div class="sv" style="color:{"#ef4444" if m["n_alerts"]>0 else "#22c55e"}">{m["n_alerts"]}</div><div class="ss">{m["n_notifs"]} 通知 · {m["n_hcu"]} 醫療利用</div></div>
</div>
<div class="sec"><h2>可行性門檻</h2><p class="sub">Primary outcome 預設目標</p>
{_pbar("收案進度", m["n"], 50, 30, "#14b8a6")}
{_pbar("App 啟用率", round(m["act_rate"]*100), 100, 80, "#3b82f6")}
{_pbar("問卷依從率", round(m["avg_adh"]*100), 100, 70, "#8b5cf6")}
{_pbar("POD 0-7 ≥5 次回報", m["pod7_ok"], m["n"] or 1, max(1,round((m["n"] or 1)*0.7)), "#f59e0b")}
</div>
<div class="sec"><h2>病人清單</h2>
<div style="overflow-x:auto"><table>
<thead><tr><th>研究編號</th><th>年齡</th><th>性別</th><th>手術方式</th><th>手術日期</th><th>痔瘡分級</th><th>App</th><th>狀態</th></tr></thead>
<tbody>{ptrows if ptrows else '<tr><td colspan="8" class="dim" style="text-align:center">尚無病人</td></tr>'}</tbody>
</table></div></div>
<div class="g2">
<div class="sec fig"><h2>收案進度</h2><img src="fig_enrollment.png"></div>
<div class="sec fig"><h2>可行性達成</h2><img src="fig_feasibility.png"></div>
</div>
<div class="sec fig"><h2>疼痛趨勢 (NRS 0–10)</h2><img src="fig_pain_trajectory.png"></div>
<div class="g2">
<div class="sec fig"><h2>出血 / 排便分布</h2><img src="fig_symptoms.png"></div>
<div class="sec"><h2>個別病人依從性</h2>{abars if abars else '<div class="ok"><div class="d">尚無資料</div></div>'}</div>
</div>
<div class="g2">
<div class="sec fig"><h2>AI 主題分布</h2><img src="fig_ai_topics.png"></div>
<div class="sec"><h2>AI 品質審查</h2>
<table><tr><th>狀態</th><th>筆數</th></tr>
<tr><td style="color:#22c55e">✅ 正確</td><td>{m["rev_res"]["correct"]}</td></tr>
<tr><td style="color:#ef4444">❌ 不正確</td><td>{m["rev_res"]["incorrect"]}</td></tr>
<tr><td class="dim">⏳ 待審查</td><td>{m["rev_res"]["pending"]}</td></tr>
</table>
<div style="margin-top:14px;font-size:12px;color:#64748b">
API：{len(m["ai_reqs"])} 次請求 · {m["in_tok"]:,} 輸入 / {m["out_tok"]:,} 輸出 tokens · 平均延遲 {m["avg_lat"]:.0f}ms
</div></div>
</div>
<div class="sec"><h2>症狀回報明細</h2>
<div style="overflow-x:auto"><table>
<thead><tr><th>研究編號</th><th>POD</th><th>日期</th><th>疼痛 (NRS)</th><th>出血</th><th>排便</th><th>傷口</th><th>發燒</th><th>排尿</th><th>控便</th></tr></thead>
<tbody>{rrows if rrows else '<tr><td colspan="10" class="dim" style="text-align:center">尚無回報</td></tr>'}</tbody>
</table></div></div>
<div class="sec"><h2>AI 對話紀錄</h2>
<div style="overflow-x:auto;max-height:400px;overflow-y:auto"><table>
<thead><tr><th>編號</th><th>時間</th><th>病人提問</th><th>主題</th><th>審查</th><th>結果</th></tr></thead>
<tbody>{crows if crows else '<tr><td colspan="6" class="dim" style="text-align:center">尚無對話</td></tr>'}</tbody>
</table></div></div>
<div class="sec"><h2>警示紀錄</h2>
{arows if arows else '<div class="ok"><div class="i">✅</div><div class="t">尚無警示觸發</div><div class="d">NRS≥8 連續3次 · 出血持續或血塊 · 便秘≥3天 · 體溫≥38°C</div></div>'}
</div>
</div>
<footer>Colon & Code · drhuang.crs · KVGH 高雄榮總</footer>
</body></html>'''
    (OUTPUT_DIR/"dashboard.html").write_text(html, encoding="utf-8")
    print("  ✅ dashboard.html")

# ═══════════════════════════════════════════════════════════════════════════
def main():
    print("="*60)
    print("  Hemorrhoids_PostOp 研究進度儀表板")
    print("="*60)
    data = fetch_all()
    print("\n📊 計算指標...")
    m = compute(data)
    print(f"  收案數：  {m['n']}")
    print(f"  回報數：  {len(m['reports'])}")
    print(f"  AI 對話： {m['n_chats']}")
    print(f"  警示：    {m['n_alerts']}")
    print(f"  啟用率：  {m['act_rate']*100:.1f}%")
    print(f"  依從率：  {m['avg_adh']*100:.1f}%")
    print(f"\n🎨 產生圖表 (300 dpi)...")
    fig_enrollment(m); fig_pain(m); fig_adherence(m)
    fig_symptoms(m); fig_ai_topics(m); fig_feasibility(m)
    print(f"\n🌐 產生 HTML 儀表板...")
    gen_html(m)
    print(f"\n{'='*60}")
    print(f"  ✅ 所有輸出 → {OUTPUT_DIR.resolve()}")
    print(f"  📄 dashboard.html — 用瀏覽器開啟")
    print(f"  🖼️  fig_*.png — 投稿用圖 (300 dpi)")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
