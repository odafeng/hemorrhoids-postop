// Rule-based alert engine
// Based on protocol: pain ≥ 8 for 3+ days, ascending pain 3+ days,
// persistent bleeding 2+ consecutive, no bowel 3+ days, fever, urinary retention

// Every streak rule below counts consecutive *reports*, not calendar days — and it
// must stay that way: the follow-up schedule tapers (daily to POD 7, then every
// 2 days, then weekly), so non-adjacent reports are the designed norm and requiring
// date adjacency would switch these safety alerts off for most of the 30-day window.
// The messages must therefore never claim calendar days. Stating the span makes any
// gap visible to the clinician instead of implying it away: HSF-001 reported soiling
// on POD 7 and POD 9 with nothing on POD 8, and the alert read "已連續 2 天".
function reportSpan(reports, count) {
  const window = reports.slice(0, count);
  const newest = window[0].date;
  const oldest = window[window.length - 1].date;
  return oldest === newest ? oldest : `${oldest} 至 ${newest}`;
}

export function checkAlerts(reports) {
  const alerts = [];
  if (!reports || reports.length === 0) return alerts;

  // Sort by date descending
  const sorted = [...reports].sort((a, b) => b.date.localeCompare(a.date));
  const recentReports = sorted.slice(0, 7);
  const latestReport = sorted[0];

  // 1. Pain ≥ 8 for 3+ consecutive days
  let consecutiveHighPain = 0;
  for (const r of recentReports) {
    if (r.pain >= 8) {
      consecutiveHighPain++;
    } else {
      break;
    }
  }
  if (consecutiveHighPain >= 3) {
    alerts.push({
      id: 'high_pain',
      type: 'danger',
      icon: '🔴',
      title: '持續性高度疼痛',
      message: `已連續 ${consecutiveHighPain} 次回報疼痛分數 ≥ 8（${reportSpan(recentReports, consecutiveHighPain)}），建議聯絡醫療機構或回診評估。`,
    });
  }

  // 2. Ascending pain — 3+ consecutive days of increasing pain (越來越痛)
  if (recentReports.length >= 3) {
    // Check most recent 3 days in chronological order
    const recent3 = recentReports.slice(0, 3).reverse(); // oldest → newest
    const isAscending = recent3[1].pain > recent3[0].pain && recent3[2].pain > recent3[1].pain;
    if (isAscending) {
      alerts.push({
        id: 'ascending_pain',
        type: 'warning',
        icon: '📈',
        title: '疼痛逐日上升',
        message: `近 3 天疼痛持續上升（${recent3.map(r => r.pain).join(' → ')}），一般術後疼痛應逐日遞減，建議聯絡醫療機構評估。`,
      });
    }
  }

  // 3. Persistent bleeding — 連續 2 次回報為「持續」才觸發
  let consecutivePersistentBleeding = 0;
  for (const r of recentReports) {
    if (r.bleeding === '持續') {
      consecutivePersistentBleeding++;
    } else {
      break;
    }
  }
  if (consecutivePersistentBleeding >= 2) {
    alerts.push({
      id: 'persistent_bleeding',
      type: 'danger',
      icon: '🩸',
      title: '持續性出血',
      message: `已連續 ${consecutivePersistentBleeding} 次回報持續性出血（排便後滴血、馬桶水變色；${reportSpan(recentReports, consecutivePersistentBleeding)}），建議儘速聯絡醫療機構評估。`,
    });
  }

  // Blood clot — single instance is enough (immediate concern)
  if (latestReport && latestReport.bleeding === '血塊') {
    alerts.push({
      id: 'blood_clot',
      type: 'danger',
      icon: '🩸',
      title: '出血伴隨血塊',
      message: '您回報了出血伴隨血塊，建議儘速聯絡醫療機構評估。',
    });
  }

  // 4. No bowel movement for 3+ days
  let consecutiveNoBowel = 0;
  for (const r of recentReports) {
    if (r.bowel === '未排') {
      consecutiveNoBowel++;
    } else {
      break;
    }
  }
  if (consecutiveNoBowel >= 3) {
    alerts.push({
      id: 'no_bowel',
      type: 'warning',
      icon: '⚠️',
      title: '超過3天未排便',
      message: `已連續 ${consecutiveNoBowel} 次回報未排便（${reportSpan(recentReports, consecutiveNoBowel)}），建議聯絡醫療機構評估是否需要處置。`,
    });
  }

  // 5. Fever
  if (latestReport && latestReport.fever) {
    alerts.push({
      id: 'fever',
      type: 'danger',
      icon: '🌡️',
      title: '發燒',
      message: '您回報了發燒症狀，建議儘速聯絡醫療機構評估。',
    });
  }

  // 6. Urinary retention (完全尿不出來) — immediate concern
  if (latestReport && latestReport.urinary === '尿不出來') {
    alerts.push({
      id: 'urinary_retention',
      type: 'danger',
      icon: '🚨',
      title: '完全尿不出來',
      message: '您回報了完全尿不出來，這是術後需要立即處理的狀況，建議儘速聯絡醫療機構。',
    });
  }

  // Urinary difficulty — warning if consecutive
  if (latestReport && latestReport.urinary === '困難') {
    let consecutiveUrinaryDifficulty = 0;
    for (const r of recentReports) {
      if (r.urinary === '困難' || r.urinary === '尿不出來') {
        consecutiveUrinaryDifficulty++;
      } else {
        break;
      }
    }
    if (consecutiveUrinaryDifficulty >= 2) {
      alerts.push({
        id: 'urinary_difficulty',
        type: 'warning',
        icon: '⚠️',
        title: '排尿困難',
        message: `已連續 ${consecutiveUrinaryDifficulty} 次回報排尿困難（${reportSpan(recentReports, consecutiveUrinaryDifficulty)}），建議聯絡醫療機構評估。`,
      });
    }
  }

  // 8. Incontinence (肛門失禁)
  if (latestReport && latestReport.continence === '失禁') {
    alerts.push({
      id: 'incontinence',
      type: 'danger',
      icon: '🚨',
      title: '肛門失禁',
      message: '您回報了無法控制排便，建議儘速聯絡醫療機構評估。',
    });
  }

  // Soiling (滲便) — warning if consecutive 2+ days
  if (latestReport && latestReport.continence === '滲便') {
    let consecutiveSoiling = 0;
    for (const r of recentReports) {
      if (r.continence === '滲便' || r.continence === '失禁') {
        consecutiveSoiling++;
      } else {
        break;
      }
    }
    if (consecutiveSoiling >= 2) {
      alerts.push({
        id: 'soiling',
        type: 'warning',
        icon: '⚠️',
        title: '持續滲便',
        message: `已連續 ${consecutiveSoiling} 次回報出現滲漏（${reportSpan(recentReports, consecutiveSoiling)}），建議聯絡醫療機構評估。`,
      });
    }
  }

  return alerts;
}

export function getAlertLevel(alerts) {
  if (alerts.some(a => a.type === 'danger')) return 'danger';
  if (alerts.some(a => a.type === 'warning')) return 'warning';
  return 'safe';
}
