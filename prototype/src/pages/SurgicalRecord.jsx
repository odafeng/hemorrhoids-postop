import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as sb from '../utils/supabaseService';
import * as I from '../components/Icons';

const HEM_SUBTYPES = [
  { v: 'open',        label: 'Open',        d: '傷口不縫合' },
  { v: 'closed',      label: 'Closed',      d: '傷口完全縫合（Ferguson）' },
  { v: 'semi_open',   label: 'Semi-open',   d: '部分縫合，中央開放' },
  { v: 'semi_closed', label: 'Semi-closed', d: '大部分縫合，末端開放' },
];
const GRADES = ['I', 'II', 'III', 'IV'];
const ANESTHESIA_TYPES = [
  { v: 'IVGA', label: 'IVGA', d: '靜脈全身麻醉' },
  { v: 'LMGA', label: 'LMGA', d: '喉罩全身麻醉' },
  { v: 'SA',   label: 'SA',   d: '脊椎麻醉' },
  { v: 'LA',   label: 'LA',   d: '局部麻醉' },
];
const CLOCK_POSITIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const POSITIONS = [
  { v: 'lithotomy',       label: 'Lithotomy' },
  { v: 'prone_jackknife', label: 'Prone jackknife' },
  { v: 'left_lateral',    label: 'Left lateral' },
  { v: 'other',           label: '其他' },
];
const HEMOSTATIC_GAUZE = [
  { v: 'quikclot', label: 'Quikclot' },
  { v: 'military', label: '國軍' },
  { v: 'other',    label: '其他' },
];
const WOUND_GEL = [
  { v: 'liquidband', label: 'LiquidBand' },
  { v: 'glitch',     label: 'Glitch' },
  { v: 'other',      label: '其他' },
];
const WOUND_SPRAY = [
  { v: 'newepi', label: 'NewEpi' },
  { v: 'other',  label: '其他' },
];
const ENERGY_DEVICES = [
  { v: 'ligasure',  label: 'LigaSure' },
  { v: 'powerseal', label: 'Powerseal' },
  { v: 'harmonic',  label: 'Harmonic' },
];
const SUBTYPES_NEEDING_SUTURE = new Set(['closed', 'semi_open', 'semi_closed']);

export default function SurgicalRecord({ isDemo, userInfo }) {
  const { studyId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [patient, setPatient] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isReadOnly = userInfo?.role === 'patient' || isDemo;

  // Form state
  const [procedureType, setProcedureType] = useState('');
  const [subtype, setSubtype] = useState('');
  const [grade, setGrade] = useState('');
  const [clockPositions, setClockPositions] = useState([]);
  const [joules, setJoules] = useState({ 3: '', 7: '', 11: '' });
  const [bloodLoss, setBloodLoss] = useState('');
  const [duration, setDuration] = useState('');
  const [position, setPosition] = useState('');
  const [anesthesiaType, setAnesthesiaType] = useState('');
  const [selfPaid, setSelfPaid] = useState({
    hemostatic_gauze: [],
    hemostatic_gauze_other: '',
    wound_gel: [],
    wound_gel_other: '',
    wound_spray: [],
    wound_spray_other: '',
    prp: false,
    prp_brand: '',
    healiaid: false,
    other: '',
  });
  const [notes, setNotes] = useState('');
  // Common findings (both procedures)
  const [skinTags, setSkinTags] = useState(false);
  const [thrombus, setThrombus] = useState(false);
  // Laser-only extras
  const [partialHem, setPartialHem] = useState(false);
  const [partialHemPositions, setPartialHemPositions] = useState([]);
  const [pedicleLig, setPedicleLig] = useState(false);
  const [pedicleLigPositions, setPedicleLigPositions] = useState([]);
  const [mucosalInjury, setMucosalInjury] = useState(false);
  const [mucosalRepaired, setMucosalRepaired] = useState(null);
  const [mucosalInjuryPositions, setMucosalInjuryPositions] = useState([]);
  // Hemorrhoidectomy-only extras
  const [energyDevice, setEnergyDevice] = useState(['ligasure']);
  const [sutureMaterial, setSutureMaterial] = useState('');

  useEffect(() => {
    const load = async () => {
      if (isDemo || !studyId) {
        setLoading(false);
        return;
      }
      try {
        const [p, rec] = await Promise.all([
          sb.getPatient(studyId),
          sb.getSurgicalRecord(studyId),
        ]);
        setPatient(p);
        if (rec) {
          setProcedureType(rec.procedure_type || '');
          setSubtype(rec.hemorrhoidectomy_subtype || '');
          setGrade(rec.hemorrhoid_grade || '');
          setClockPositions(rec.clock_positions || []);
          if (rec.laser_joules) {
            setJoules({
              3: rec.laser_joules['3'] ?? '',
              7: rec.laser_joules['7'] ?? '',
              11: rec.laser_joules['11'] ?? '',
            });
          }
          setBloodLoss(rec.blood_loss_ml ?? '');
          setDuration(rec.duration_min ?? '');
          setPosition(rec.patient_position || '');
          setAnesthesiaType(rec.anesthesia_type || '');
          if (rec.self_paid) {
            // Back-compat: legacy rows stored newepi as a boolean; promote into wound_spray group.
            const legacyNewepi = !!rec.self_paid.newepi;
            const spray = rec.self_paid.wound_spray
              || (legacyNewepi ? ['newepi'] : []);
            setSelfPaid({
              hemostatic_gauze: rec.self_paid.hemostatic_gauze || [],
              hemostatic_gauze_other: rec.self_paid.hemostatic_gauze_other || '',
              wound_gel: rec.self_paid.wound_gel || [],
              wound_gel_other: rec.self_paid.wound_gel_other || '',
              wound_spray: spray,
              wound_spray_other: rec.self_paid.wound_spray_other || '',
              prp: !!rec.self_paid.prp,
              prp_brand: rec.self_paid.prp_brand || '',
              healiaid: !!rec.self_paid.healiaid,
              other: rec.self_paid.other || '',
            });
          }
          setNotes(rec.notes || '');
          setSkinTags(!!rec.skin_tags);
          setThrombus(!!rec.thrombus);
          setPartialHem(!!rec.combined_partial_hemorrhoidectomy);
          setPartialHemPositions(rec.combined_partial_hemorrhoidectomy_positions || []);
          setPedicleLig(!!rec.pedicle_ligation);
          setPedicleLigPositions(rec.pedicle_ligation_positions || []);
          setMucosalInjury(!!rec.mucosal_injury);
          setMucosalRepaired(rec.mucosal_injury_repaired);
          setMucosalInjuryPositions(rec.mucosal_injury_positions || []);
          setEnergyDevice(rec.energy_device && rec.energy_device.length ? rec.energy_device : ['ligasure']);
          setSutureMaterial(rec.suture_material || '');
        }
      } catch (err) {
        setError(err?.message || '載入失敗');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [studyId, isDemo]);

  const toggleClockIn = (list, setList) => (n) => {
    setList(list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));
  };
  const toggleClock = toggleClockIn(clockPositions, setClockPositions);
  const togglePartialHemPos = toggleClockIn(partialHemPositions, setPartialHemPositions);
  const togglePedicleLigPos = toggleClockIn(pedicleLigPositions, setPedicleLigPositions);
  const toggleMucosalPos = toggleClockIn(mucosalInjuryPositions, setMucosalInjuryPositions);

  const toggleInArray = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const toggleGauze = (v) => setSelfPaid((p) => ({ ...p, hemostatic_gauze: toggleInArray(p.hemostatic_gauze, v) }));
  const toggleWoundGel = (v) => setSelfPaid((p) => ({ ...p, wound_gel: toggleInArray(p.wound_gel, v) }));
  const toggleSpray = (v) => setSelfPaid((p) => ({ ...p, wound_spray: toggleInArray(p.wound_spray, v) }));
  const toggleEnergy = (v) => setEnergyDevice((p) => toggleInArray(p, v));

  const canSubmit = !!procedureType && !!grade && !isReadOnly && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    setSuccess('');

    const isLaser = procedureType === 'laser_hemorrhoidoplasty';
    const isHem = procedureType === 'hemorrhoidectomy';
    const needsSuture = isHem && SUBTYPES_NEEDING_SUTURE.has(subtype);

    // Scrub "other" text fields when the corresponding "其他" chip isn't selected
    const cleanedSelfPaid = {
      hemostatic_gauze: selfPaid.hemostatic_gauze,
      hemostatic_gauze_other: selfPaid.hemostatic_gauze.includes('other') ? (selfPaid.hemostatic_gauze_other || '').trim() : '',
      wound_gel: selfPaid.wound_gel,
      wound_gel_other: selfPaid.wound_gel.includes('other') ? (selfPaid.wound_gel_other || '').trim() : '',
      wound_spray: selfPaid.wound_spray,
      wound_spray_other: selfPaid.wound_spray.includes('other') ? (selfPaid.wound_spray_other || '').trim() : '',
      prp: selfPaid.prp,
      prp_brand: selfPaid.prp ? (selfPaid.prp_brand || '').trim() : '',
      healiaid: selfPaid.healiaid,
      other: (selfPaid.other || '').trim(),
    };

    const payload = {
      procedure_type: procedureType,
      hemorrhoidectomy_subtype: isHem ? (subtype || null) : null,
      hemorrhoid_grade: grade,
      clock_positions: clockPositions,
      laser_joules: isLaser
        ? {
            3: joules[3] ? Number(joules[3]) : null,
            7: joules[7] ? Number(joules[7]) : null,
            11: joules[11] ? Number(joules[11]) : null,
          }
        : null,
      blood_loss_ml: bloodLoss === '' ? null : Number(bloodLoss),
      duration_min: duration === '' ? null : Number(duration),
      patient_position: position || null,
      anesthesia_type: anesthesiaType || null,
      self_paid: cleanedSelfPaid,
      notes: notes.trim() || null,
      // Laser-only extras
      combined_partial_hemorrhoidectomy: isLaser ? partialHem : false,
      combined_partial_hemorrhoidectomy_positions: isLaser && partialHem ? partialHemPositions : [],
      pedicle_ligation: isLaser ? pedicleLig : false,
      pedicle_ligation_positions: isLaser && pedicleLig ? pedicleLigPositions : [],
      mucosal_injury: isLaser ? mucosalInjury : false,
      mucosal_injury_repaired: isLaser && mucosalInjury ? mucosalRepaired : null,
      mucosal_injury_positions: isLaser && mucosalInjury ? mucosalInjuryPositions : [],
      // Hemorrhoidectomy-only extras
      energy_device: isHem ? energyDevice : [],
      suture_material: needsSuture ? (sutureMaterial.trim() || null) : null,
      // Common findings
      skin_tags: skinTags,
      thrombus: thrombus,
      recorded_by: userInfo?.id || null,
      surgeon_id: patient?.surgeon_id || userInfo?.surgeonId || null,
    };

    try {
      await sb.saveSurgicalRecord(studyId, payload);
      setSuccess('手術紀錄已儲存');
      setTimeout(() => navigate(-1), 1200);
    } catch (err) {
      if (err?.code === '42501' || /row-level|policy/i.test(err?.message || '')) {
        setError('此病人不屬於您的主刀醫師，無法儲存紀錄');
      } else {
        setError(err?.message || '儲存失敗');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <p style={{ color: 'var(--ink-2)', animation: 'pulse 1s infinite', fontFamily: 'var(--font-mono)' }}>載入中…</p>
      </div>
    );
  }

  if (isDemo) {
    return (
      <div className="page">
        <div className="topbar">
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="返回">
            <I.ArrowLeft width={17} height={17} />
          </button>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
            OPERATIVE RECORD
          </div>
          <div style={{ width: 36 }} />
        </div>
        <div className="page-head">
          <div className="eyebrow">OPERATIVE RECORD</div>
          <h1 className="page-title">手術紀錄</h1>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>Demo 模式不支援手術紀錄編輯。</p>
        </div>
      </div>
    );
  }

  const surgeryDate = patient?.surgery_date
    ? new Date(patient.surgery_date).toLocaleDateString('zh-TW')
    : '—';

  return (
    <div className="page">
      <div className="topbar">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="返回">
          <I.ArrowLeft width={17} height={17} />
        </button>
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
          {studyId} · {surgeryDate}
        </div>
        <div style={{ width: 36 }} />
      </div>

      <div className="page-head">
        <div className="eyebrow">OPERATIVE RECORD</div>
        <h1 className="page-title">{isReadOnly ? '檢視手術紀錄' : '撰寫手術紀錄'}</h1>
        <p className="page-sub">
          {patient?.surgeon_id && <>主刀：{patient.surgeon_id}{' · '}</>}
          術式：{patient?.surgery_type || '—'}
        </p>
      </div>

      {isReadOnly && (
        <div className="alert-banner info" style={{ marginBottom: 12 }}>
          <div className="al-icon"><I.Info width={18} height={18} /></div>
          <div><div className="al-msg">此頁為唯讀檢視</div></div>
        </div>
      )}

      {/* Procedure type */}
      <div className="field">
        <div className="field-lbl">手術術式</div>
        <div className="opt-row">
          <button type="button"
            className={`opt ${procedureType === 'hemorrhoidectomy' ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setProcedureType('hemorrhoidectomy')}
            disabled={isReadOnly}>
            <span className="opt-main">痔瘡切除術</span>
          </button>
          <button type="button"
            className={`opt ${procedureType === 'laser_hemorrhoidoplasty' ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setProcedureType('laser_hemorrhoidoplasty')}
            disabled={isReadOnly}>
            <span className="opt-main">Laser hemorrhoidoplasty</span>
          </button>
        </div>
      </div>

      {/* Subtype (hemorrhoidectomy only) */}
      {procedureType === 'hemorrhoidectomy' && (
        <div className="field">
          <div className="field-lbl">Hemorrhoidectomy 分型</div>
          <div className="opt-stack">
            {HEM_SUBTYPES.map((o) => (
              <button key={o.v} type="button"
                className={`opt ${subtype === o.v ? 'selected' : ''}`}
                onClick={() => !isReadOnly && setSubtype(o.v)}
                disabled={isReadOnly}>
                <span className="opt-main">{o.label}</span>
                <span className="opt-desc">{o.d}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Energy device (hemorrhoidectomy only) */}
      {procedureType === 'hemorrhoidectomy' && (
        <div className="field">
          <div className="field-lbl">Energy device <span className="hint">可複選</span></div>
          <div className="chip-grid">
            {ENERGY_DEVICES.map((o) => (
              <button key={o.v} type="button"
                className={`chip ${energyDevice.includes(o.v) ? 'selected' : ''}`}
                onClick={() => !isReadOnly && toggleEnergy(o.v)}
                disabled={isReadOnly}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suture material (closed / semi-open / semi-closed only) */}
      {procedureType === 'hemorrhoidectomy' && SUBTYPES_NEEDING_SUTURE.has(subtype) && (
        <div className="field">
          <div className="field-lbl">縫線 <span className="hint">廠牌 / 規格</span></div>
          <input className="input" type="text"
            placeholder="例如：Vicryl 3-0、Monocryl 4-0"
            value={sutureMaterial}
            onChange={(e) => !isReadOnly && setSutureMaterial(e.target.value)}
            disabled={isReadOnly} />
        </div>
      )}

      {/* Grade */}
      <div className="field">
        <div className="field-lbl">痔瘡分級 <span className="hint">Goligher</span></div>
        <div className="opt-row">
          {GRADES.map((g) => (
            <button key={g} type="button"
              className={`opt ${grade === g ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setGrade(g)}
              disabled={isReadOnly}>
              <span className="opt-main">Grade {g}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Clock positions */}
      <div className="field">
        <div className="field-lbl">位置 <span className="hint">時鐘方向 · 可複選</span></div>
        <div className="chip-grid">
          {CLOCK_POSITIONS.map((n) => (
            <button key={n} type="button"
              className={`chip ${clockPositions.includes(n) ? 'selected' : ''}`}
              onClick={() => !isReadOnly && toggleClock(n)}
              disabled={isReadOnly}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Skin tags */}
      <div className="field">
        <div className="field-lbl">Skin tags</div>
        <div className="opt-row">
          <button type="button" className={`opt ${skinTags === false ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setSkinTags(false)} disabled={isReadOnly}>
            <span className="opt-main">否</span>
          </button>
          <button type="button" className={`opt ${skinTags === true ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setSkinTags(true)} disabled={isReadOnly}>
            <span className="opt-main">是</span>
          </button>
        </div>
      </div>

      {/* Thrombus */}
      <div className="field">
        <div className="field-lbl">Thrombus</div>
        <div className="opt-row">
          <button type="button" className={`opt ${thrombus === false ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setThrombus(false)} disabled={isReadOnly}>
            <span className="opt-main">否</span>
          </button>
          <button type="button" className={`opt ${thrombus === true ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setThrombus(true)} disabled={isReadOnly}>
            <span className="opt-main">是</span>
          </button>
        </div>
      </div>

      {/* Laser joules */}
      {procedureType === 'laser_hemorrhoidoplasty' && (
        <div className="field">
          <div className="field-lbl">Laser energy (J) <span className="hint">3 / 7 / 11 點鐘方向</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[3, 7, 11].map((h) => (
              <div key={h}>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 4 }}>
                  {h} 點鐘 (J)
                </div>
                <input className="input" type="number" min="0" step="1"
                  value={joules[h]}
                  onChange={(e) => !isReadOnly && setJoules((prev) => ({ ...prev, [h]: e.target.value }))}
                  disabled={isReadOnly} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Laser-only extras: partial hemorrhoidectomy */}
      {procedureType === 'laser_hemorrhoidoplasty' && (
        <div className="field">
          <div className="field-lbl">合併 partial hemorrhoidectomy</div>
          <div className="opt-row">
            <button type="button" className={`opt ${partialHem === false ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setPartialHem(false)} disabled={isReadOnly}>
              <span className="opt-main">否</span>
            </button>
            <button type="button" className={`opt ${partialHem === true ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setPartialHem(true)} disabled={isReadOnly}>
              <span className="opt-main">是</span>
            </button>
          </div>
          {partialHem && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 6 }}>
                方位 · 時鐘方向 · 可複選
              </div>
              <div className="chip-grid">
                {CLOCK_POSITIONS.map((n) => (
                  <button key={n} type="button"
                    className={`chip ${partialHemPositions.includes(n) ? 'selected' : ''}`}
                    onClick={() => !isReadOnly && togglePartialHemPos(n)}
                    disabled={isReadOnly}>{n}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Laser-only extras: pedicle ligation */}
      {procedureType === 'laser_hemorrhoidoplasty' && (
        <div className="field">
          <div className="field-lbl">Pedicle ligation</div>
          <div className="opt-row">
            <button type="button" className={`opt ${pedicleLig === false ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setPedicleLig(false)} disabled={isReadOnly}>
              <span className="opt-main">否</span>
            </button>
            <button type="button" className={`opt ${pedicleLig === true ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setPedicleLig(true)} disabled={isReadOnly}>
              <span className="opt-main">是</span>
            </button>
          </div>
          {pedicleLig && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 6 }}>
                方位 · 時鐘方向 · 可複選
              </div>
              <div className="chip-grid">
                {CLOCK_POSITIONS.map((n) => (
                  <button key={n} type="button"
                    className={`chip ${pedicleLigPositions.includes(n) ? 'selected' : ''}`}
                    onClick={() => !isReadOnly && togglePedicleLigPos(n)}
                    disabled={isReadOnly}>{n}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Laser-only extras: mucosal laser energy injury */}
      {procedureType === 'laser_hemorrhoidoplasty' && (
        <div className="field">
          <div className="field-lbl">Mucosal laser energy injury</div>
          <div className="opt-row">
            <button type="button" className={`opt ${mucosalInjury === false ? 'selected' : ''}`}
              onClick={() => { if (!isReadOnly) { setMucosalInjury(false); setMucosalRepaired(null); } }}
              disabled={isReadOnly}>
              <span className="opt-main">否</span>
            </button>
            <button type="button" className={`opt ${mucosalInjury === true ? 'selected danger' : ''}`}
              onClick={() => !isReadOnly && setMucosalInjury(true)} disabled={isReadOnly}>
              <span className="opt-main">是</span>
            </button>
          </div>
          {mucosalInjury && (
            <>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 6 }}>
                  有無 repair
                </div>
                <div className="opt-row">
                  <button type="button" className={`opt ${mucosalRepaired === false ? 'selected danger' : ''}`}
                    onClick={() => !isReadOnly && setMucosalRepaired(false)} disabled={isReadOnly}>
                    <span className="opt-main">無 repair</span>
                  </button>
                  <button type="button" className={`opt ${mucosalRepaired === true ? 'selected' : ''}`}
                    onClick={() => !isReadOnly && setMucosalRepaired(true)} disabled={isReadOnly}>
                    <span className="opt-main">已 repair</span>
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', marginBottom: 6 }}>
                  方位 · 時鐘方向 · 可複選
                </div>
                <div className="chip-grid">
                  {CLOCK_POSITIONS.map((n) => (
                    <button key={n} type="button"
                      className={`chip ${mucosalInjuryPositions.includes(n) ? 'selected' : ''}`}
                      onClick={() => !isReadOnly && toggleMucosalPos(n)}
                      disabled={isReadOnly}>{n}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Blood loss */}
      <div className="field">
        <div className="field-lbl">出血量 <span className="hint">ml</span></div>
        <input className="input" type="number" min="0" step="1" placeholder="0"
          value={bloodLoss}
          onChange={(e) => !isReadOnly && setBloodLoss(e.target.value)}
          disabled={isReadOnly} />
      </div>

      {/* Duration */}
      <div className="field">
        <div className="field-lbl">手術時長 <span className="hint">分鐘</span></div>
        <input className="input" type="number" min="0" step="1" placeholder="0"
          value={duration}
          onChange={(e) => !isReadOnly && setDuration(e.target.value)}
          disabled={isReadOnly} />
      </div>

      {/* Anesthesia type */}
      <div className="field">
        <div className="field-lbl">麻醉方式</div>
        <div className="opt-row" style={{ flexWrap: 'wrap' }}>
          {ANESTHESIA_TYPES.map((o) => (
            <button key={o.v} type="button"
              className={`opt ${anesthesiaType === o.v ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setAnesthesiaType(o.v)}
              disabled={isReadOnly}
              title={o.d}>
              <span className="opt-main">{o.label}</span>
              <span className="opt-desc">{o.d}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Patient position */}
      <div className="field">
        <div className="field-lbl">擺位</div>
        <div className="opt-row" style={{ flexWrap: 'wrap' }}>
          {POSITIONS.map((o) => (
            <button key={o.v} type="button"
              className={`opt ${position === o.v ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setPosition(o.v)}
              disabled={isReadOnly}>
              <span className="opt-main">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Self-paid items */}
      <div className="field">
        <div className="field-lbl">自費品項 <span className="hint">可複選</span></div>

        {/* 止血紗 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>止血紗</div>
          <div className="chip-grid">
            {HEMOSTATIC_GAUZE.map((o) => (
              <button key={o.v} type="button"
                className={`chip ${selfPaid.hemostatic_gauze.includes(o.v) ? 'selected' : ''}`}
                onClick={() => !isReadOnly && toggleGauze(o.v)}
                disabled={isReadOnly}>
                {o.label}
              </button>
            ))}
          </div>
          {selfPaid.hemostatic_gauze.includes('other') && (
            <input className="input" style={{ marginTop: 8 }}
              type="text" placeholder="止血紗品名"
              value={selfPaid.hemostatic_gauze_other}
              onChange={(e) => !isReadOnly && setSelfPaid((p) => ({ ...p, hemostatic_gauze_other: e.target.value }))}
              disabled={isReadOnly} />
          )}
        </div>

        {/* 傷口凝膠 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>傷口凝膠</div>
          <div className="chip-grid">
            {WOUND_GEL.map((o) => (
              <button key={o.v} type="button"
                className={`chip ${selfPaid.wound_gel.includes(o.v) ? 'selected' : ''}`}
                onClick={() => !isReadOnly && toggleWoundGel(o.v)}
                disabled={isReadOnly}>
                {o.label}
              </button>
            ))}
          </div>
          {selfPaid.wound_gel.includes('other') && (
            <input className="input" style={{ marginTop: 8 }}
              type="text" placeholder="傷口凝膠品名"
              value={selfPaid.wound_gel_other}
              onChange={(e) => !isReadOnly && setSelfPaid((p) => ({ ...p, wound_gel_other: e.target.value }))}
              disabled={isReadOnly} />
          )}
        </div>

        {/* PRP */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>PRP</div>
          <div className="opt-row">
            <button type="button"
              className={`opt ${!selfPaid.prp ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setSelfPaid((p) => ({ ...p, prp: false, prp_brand: '' }))}
              disabled={isReadOnly}>
              <span className="opt-main">否</span>
            </button>
            <button type="button"
              className={`opt ${selfPaid.prp ? 'selected' : ''}`}
              onClick={() => !isReadOnly && setSelfPaid((p) => ({ ...p, prp: true }))}
              disabled={isReadOnly}>
              <span className="opt-main">是</span>
            </button>
          </div>
          {selfPaid.prp && (
            <input className="input" style={{ marginTop: 8 }}
              type="text" placeholder="PRP 廠牌（例如：Regen Lab）"
              value={selfPaid.prp_brand}
              onChange={(e) => !isReadOnly && setSelfPaid((p) => ({ ...p, prp_brand: e.target.value }))}
              disabled={isReadOnly} />
          )}
        </div>

        {/* 傷口噴劑 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>傷口噴劑</div>
          <div className="chip-grid">
            {WOUND_SPRAY.map((o) => (
              <button key={o.v} type="button"
                className={`chip ${selfPaid.wound_spray.includes(o.v) ? 'selected' : ''}`}
                onClick={() => !isReadOnly && toggleSpray(o.v)}
                disabled={isReadOnly}>
                {o.label}
              </button>
            ))}
          </div>
          {selfPaid.wound_spray.includes('other') && (
            <input className="input" style={{ marginTop: 8 }}
              type="text" placeholder="傷口噴劑品名"
              value={selfPaid.wound_spray_other}
              onChange={(e) => !isReadOnly && setSelfPaid((p) => ({ ...p, wound_spray_other: e.target.value }))}
              disabled={isReadOnly} />
          )}
        </div>

        {/* Healiaid */}
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <button type="button"
            className={`opt ${selfPaid.healiaid ? 'selected' : ''}`}
            onClick={() => !isReadOnly && setSelfPaid((p) => ({ ...p, healiaid: !p.healiaid }))}
            disabled={isReadOnly}>
            <span className="opt-main">Healiaid</span>
          </button>
        </div>

        {/* 其他自費品項 自由文字 */}
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, marginBottom: 6 }}>其他自費品項</div>
          <input className="input" type="text"
            placeholder="其他自費耗材（自由輸入）"
            value={selfPaid.other}
            onChange={(e) => !isReadOnly && setSelfPaid((p) => ({ ...p, other: e.target.value }))}
            disabled={isReadOnly} />
        </div>
      </div>

      {/* Notes */}
      <div className="field">
        <div className="field-lbl">其他備註 <span className="hint">特殊狀況</span></div>
        <textarea className="survey-textarea"
          placeholder="例如：合併肛裂切除、困難止血、術中併發症等…"
          value={notes}
          onChange={(e) => !isReadOnly && setNotes(e.target.value)}
          disabled={isReadOnly}
          rows={3} />
      </div>

      {error && (
        <div className="alert-banner danger" style={{ marginBottom: 12 }}>
          <div className="al-icon"><I.Alert width={18} height={18} /></div>
          <div><div className="al-msg">{error}</div></div>
        </div>
      )}
      {success && (
        <div className="alert-banner" style={{ marginBottom: 12, borderColor: 'var(--ok)', background: 'var(--ok-soft)' }}>
          <div className="al-icon" style={{ color: 'var(--ok)' }}><I.Check width={18} height={18} /></div>
          <div><div className="al-msg" style={{ color: 'var(--ok)' }}>{success}</div></div>
        </div>
      )}

      {!isReadOnly && (
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? '儲存中…' : <>儲存手術紀錄 <I.Check width={16} height={16} /></>}
        </button>
      )}
    </div>
  );
}
