// 4단계 화면: 운항 준비 · 체크리스트 창 · 운항 평가서 · 비행 기록부
import { AC } from '../sim/a320.js';
import { FT, NM } from '../sim/atmo.js';
import { tripFuel, tripTime, finalReserve, takeoffPerf, maxFlex, landingDistance, PAX_KG, MAX_PAX, LIMITS } from '../sim/perf.js';
import { greatCircle } from '../geo/proj.js';
import { AIRPORTS } from '../geo/airports.js';
import { CHECKLISTS } from '../ops/checklists.js';
import { PHASE_KO } from '../ops/monitor.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
const store = {
  get(k, d) { try { const v = localStorage.getItem('kfs.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kfs.' + k, JSON.stringify(v)); } catch { /* 무시 */ } },
};

/* ───────── 운항 준비 ───────── */
export function defaultBrief() {
  return { pax: 150, cargo: 1500, fl: 'auto', altn: null, extra: 0, toFlap: 1, thrust: 'FLEX', flex: 'auto', ab: 1 };
}

/**
 * 계산: route {dep, depRwy, dest, destRwy}, geo { planDistNm, planCruiseFt, depRwyLen, depElevFt, destRwyLen }
 */
export function computeBrief(b, route, geo, perfCache = {}) {
  const dest = AIRPORTS.find(a => a.icao === route.dest);
  const altns = AIRPORTS.filter(a => a.icao !== route.dest);
  const altn = altns.find(a => a.icao === b.altn) || altns.reduce((m, a) => {
    const d = greatCircle(dest.lat, dest.lon, a.lat, a.lon).dist; return !m || d < m.d ? { a, d } : m;
  }, null).a;
  const altnDist = greatCircle(dest.lat, dest.lon, altn.lat, altn.lon).dist / NM * 1.1 + 30;
  const cruiseFt = b.fl === 'auto' ? geo.planCruiseFt : +b.fl;
  const payload = Math.min(MAX_PAX, Math.max(0, b.pax | 0)) * PAX_KG + Math.max(0, +b.cargo || 0);
  const zfw = AC.oew + payload;
  // 연료: 중량에 따라 달라지므로 두 번 반복
  let tow = zfw + 9000, trip = 0, alternate = 0, reserve = 0, cont = 0, block = 0;
  const taxi = 200;
  for (let k = 0; k < 3; k++) {
    trip = tripFuel(geo.planDistNm, tow);
    cont = Math.max(200, Math.round(trip * 0.05 / 10) * 10);
    const lw = tow - trip;
    alternate = tripFuel(altnDist, lw);
    reserve = finalReserve(lw - alternate);
    block = taxi + trip + cont + alternate + reserve + Math.max(0, +b.extra || 0);
    tow = zfw + block - taxi;
  }
  const lw = tow - trip;
  const fuel = { taxi, trip, cont, alternate, reserve, extra: Math.max(0, +b.extra || 0), block };
  const checks = [
    { name: '무연료 중량 ZFW', v: zfw, lim: LIMITS.mzfw },
    { name: '이륙 중량 TOW', v: tow, lim: LIMITS.mtow },
    { name: '착륙 중량 LW', v: lw, lim: LIMITS.mlw },
    { name: '탑재 연료', v: block, lim: LIMITS.maxFuel },
  ];
  // 이륙 성능 (계산 비용이 있어 캐시)
  const key = `${Math.round(tow / 100)}|${b.toFlap}|${geo.depRwyLen}|${geo.depElevFt}`;
  if (!perfCache[key]) {
    const flexMax = maxFlex({ mass: tow, toFlap: +b.toFlap, tora: geo.depRwyLen, elev: geo.depElevFt * FT });
    perfCache[key] = { flexMax, toga: takeoffPerf({ mass: tow, toFlap: +b.toFlap, elev: geo.depElevFt * FT }) };
  }
  const pc = perfCache[key];
  let thrust = b.thrust, flexTemp = null;
  if (thrust === 'FLEX') {
    flexTemp = b.flex === 'auto' ? pc.flexMax : Math.min(+b.flex, pc.flexMax ?? -99);
    if (!flexTemp) thrust = 'TOGA';
  }
  const fkey = key + '|' + flexTemp;
  if (!perfCache[fkey]) perfCache[fkey] = flexTemp ? takeoffPerf({ mass: tow, toFlap: +b.toFlap, flexTemp, elev: geo.depElevFt * FT }) : pc.toga;
  const to = perfCache[fkey];
  const sp = geo.speedsFor(lw);
  const ld = landingDistance({ lw, autobrake: +b.ab, vapp: sp.vapp });
  return {
    altn, altnDist, cruiseFt, payload, zfw, tow, lw, fuel, checks, thrust, flexTemp, flexMax: pc.flexMax,
    to, tora: geo.depRwyLen, ld, lda: geo.destRwyLen, vapp: sp.vapp, time: tripTime(geo.planDistNm),
  };
}

export function renderBrief(b, r, route) {
  $('bRoute').textContent = `${route.dep} RWY ${route.depRwy} → ${route.dest} RWY ${route.destRwy}`;
  $('bPax').value = b.pax; $('bCargo').value = b.cargo; $('bExtra').value = b.extra;
  const fls = ['auto', 8000, 12000, 16000, 20000, 24000, 28000, 32000, 36000];
  const flSel = $('bFl');
  if (!flSel.options.length) for (const f of fls) flSel.add(new Option(f === 'auto' ? '자동 (거리 기준)' : 'FL' + f / 100, f));
  flSel.value = b.fl;
  const al = $('bAltn'); al.innerHTML = '';
  for (const a of AIRPORTS.filter(a => a.icao !== route.dest)) al.add(new Option(`${a.short} (${a.icao})`, a.icao));
  al.value = r.altn.icao;
  $('bFlap').value = b.toFlap; $('bThr').value = b.thrust; $('bAb').value = b.ab;
  const fx = $('bFlex'); fx.innerHTML = '';
  fx.add(new Option(`자동 (최대 ${r.flexMax ?? '-'}°C)`, 'auto'));
  for (let t = 30; t <= 66; t += 4) fx.add(new Option(t + '°C', t));
  fx.value = b.flex; $('bFlexWrap').hidden = b.thrust !== 'FLEX';

  const f = r.fuel;
  $('bFuel').innerHTML = [
    ['지상 이동 (Taxi)', f.taxi], [`운항 연료 (Trip) · 약 ${Math.round(r.time)}분`, f.trip], ['비상 연료 (5%)', f.cont],
    [`교체공항 연료 → ${r.altn.short}`, f.alternate], ['최종 예비 (30분 체공)', f.reserve], ['추가 연료', f.extra],
  ].map(([n, v]) => `<tr><td>${n}</td><td>${fmt(v)}</td></tr>`).join('') + `<tr class="sum"><td>탑재 연료 (Block)</td><td>${fmt(f.block)}</td></tr>`;
  $('bWeights').innerHTML = `<tr><td>운항 빈 중량 OEW</td><td>${fmt(AC.oew)}</td><td></td></tr><tr><td>탑재량 (승객·화물)</td><td>${fmt(r.payload)}</td><td></td></tr>` +
    r.checks.map(c => `<tr><td>${c.name}</td><td>${fmt(c.v)}</td><td class="${c.v > c.lim ? 'bad-t' : 'ok-t'}">한계 ${fmt(c.lim)}</td></tr>`).join('');
  const to = r.to;
  const toOk = to.required && to.required <= r.tora;
  $('bToRwy').textContent = `활주로 ${route.depRwy} · ${fmt(r.tora)}m`;
  $('bTo').innerHTML = `<tr><td>V1 / VR / V2</td><td>${to.v1} / ${to.vr} / ${to.v2} kt</td></tr>` +
    `<tr><td>추력</td><td>${r.thrust === 'FLEX' ? `FLEX ${r.flexTemp}°C` : 'TOGA'}</td></tr>` +
    `<tr><td>필요 이륙거리 (엔진고장 여유 포함)</td><td class="${toOk ? 'ok-t' : 'bad-t'}">${to.required ? fmt(to.required) + 'm' : '계산 실패'}</td></tr>` +
    `<tr><td>여유</td><td>${to.required ? fmt(r.tora - to.required) + 'm' : '-'}</td></tr>`;
  const ldOk = r.ld.required <= r.lda;
  $('bLdRwy').textContent = `활주로 ${route.destRwy} · ${fmt(r.lda)}m`;
  $('bLd').innerHTML = `<tr><td>착륙 속도 VAPP (FULL)</td><td>${r.vapp} kt</td></tr>` +
    `<tr><td>필요 착륙거리 (×1.15)</td><td class="${ldOk ? 'ok-t' : 'bad-t'}">${fmt(r.ld.required)}m</td></tr>` +
    `<tr><td>예상 실제 거리</td><td>${fmt(r.ld.actual)}m</td></tr>`;
  const warn = [];
  for (const c of r.checks) if (c.v > c.lim) warn.push(`${c.name} 한계 초과`);
  if (!toOk) warn.push('이륙거리 부족 — 플랩 2 또는 TOGA, 중량을 줄이세요');
  if (!ldOk) warn.push('착륙거리 부족 — 오토브레이크 MED 또는 중량 감소');
  $('bWarn').textContent = warn.length ? '⚠ ' + warn.join(' · ') : '';
  return warn.length === 0;
}

export function briefSummary(r) {
  return `TOW ${(r.tow / 1000).toFixed(1)}t · 연료 ${fmt(r.fuel.block)}kg · V1/VR/V2 ${r.to.v1}/${r.to.vr}/${r.to.v2} · ${r.thrust === 'FLEX' ? 'FLEX ' + r.flexTemp + '°C' : 'TOGA'}`;
}

/* ───────── 체크리스트 창 ───────── */
export class ChecklistPanel {
  constructor(state) {
    this.st = state; this.visible = false; this.idx = 0; this.autoFollow = true;
    document.querySelectorAll('[data-cl]').forEach(b => b.addEventListener('click', () => {
      this.autoFollow = false;
      this.idx = (this.idx + (b.dataset.cl === 'next' ? 1 : -1) + CHECKLISTS.length) % CHECKLISTS.length;
      this.render(this._ctx);
    }));
    $('clItems').addEventListener('click', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const cl = CHECKLISTS[this.idx]; const i = +li.dataset.i;
      if (!cl.items[i].auto) { this.st.toggle(cl, i); this.render(this._ctx); }
    });
  }
  toggle() { this.visible = !this.visible; this.autoFollow = true; $('clPanel').hidden = !this.visible; }
  /** 매 프레임 일부: 완료 판정은 창이 닫혀 있어도 수행 */
  tick(ctx) {
    this._ctx = ctx;
    const { ac, ap } = ctx;
    if (this.autoFollow) this.idx = Math.max(0, CHECKLISTS.findIndex(c => c.id === this.st.current));
    for (const cl of CHECKLISTS) {
      if (cl.id !== this.st.current) continue;
      const s = this.st.status(cl, ac, ap, ctx);
      if (s.all) { this._allT = (this._allT || 0) + ctx.dt; if (this._allT > 1.5) { this.st.complete(cl.id, ctx.phase); this._allT = 0; ctx.onComplete?.(cl); } }
      else this._allT = 0;
    }
    if (this.visible) this.render(ctx);
  }
  render(ctx) {
    if (!ctx) return;
    const cl = CHECKLISTS[this.idx];
    const s = this.st.status(cl, ctx.ac, ctx.ap, ctx);
    $('clTitle').textContent = cl.title;
    const html = cl.items.map((it, i) => `<li data-i="${i}" class="${s.oks[i] ? 'ok' : ''}"><span class="ck">${s.oks[i] ? '✓' : '○'}</span>` +
      `<span class="tx">${it.t}${it.note ? `<span class="nt">${it.note}</span>` : ''}${!it.auto ? '<span class="nt">(눌러서 확인)</span>' : ''}</span>${it.key ? `<span class="k">${it.key}</span>` : ''}</li>`).join('');
    if ($('clItems').innerHTML !== html) $('clItems').innerHTML = html;
    const done = this.st.done[cl.id];
    const foot = $('clFoot');
    foot.className = done ? 'muted small done' : 'muted small';
    foot.textContent = done ? '✓ 완료' : `${s.count}/${cl.items.length} · 현재 단계: ${PHASE_KO[ctx.phase] || ''}`;
  }
}

/* ───────── 운항 평가서 ───────── */
export function showReport(rep) {
  $('rpGrade').textContent = rep.grade; $('rpGrade').className = 'grade ' + rep.grade;
  $('rpTitle').textContent = rep.crashed ? '비행 중단 — ' + rep.crashed : `운항 평가 ${rep.overall}점`;
  $('rpSub').textContent = `${rep.routeText || ''}`;
  const s = [];
  if (rep.flightMin !== null) s.push(`비행시간 <b>${rep.flightMin.toFixed(0)}분</b>`);
  s.push(`블록시간 <b>${rep.blockMin.toFixed(0)}분</b>`);
  s.push(`연료 사용 <b>${fmt(rep.fuelUsed)}kg</b> · 잔량 <b>${fmt(rep.fuelRemain)}kg</b>`);
  s.push(`최고 고도 <b>${fmt(rep.maxAlt)}ft</b>`);
  if (rep.landing) s.push(`착륙 <b>${rep.landing.grade} (${rep.landing.pts}점)</b>`);
  if (rep.ga) s.push(`복행 <b>${rep.ga}회</b>`);
  $('rpStats').innerHTML = s.map(x => `<span>${x}</span>`).join('');
  $('rpCats').innerHTML = rep.cats.map(c => `<div class="rp-cat"><div class="hd"><span>${c.name}</span><span>${c.score}</span></div>` +
    `<div class="bar"><i style="width:${c.score}%;background:${c.score >= 90 ? 'var(--ok)' : c.score >= 70 ? 'var(--accent)' : 'var(--warn)'}"></i></div>` +
    `<ul>${(c.items.length ? c.items : [{ text: '특이사항 없음', delta: 0 }]).map(it => `<li class="${it.delta < 0 ? 'neg' : ''}">${it.text}${it.delta ? ` (${it.delta})` : ''}</li>`).join('')}</ul></div>`).join('');
  $('report').hidden = false;
}

/* ───────── 비행 기록부 ───────── */
export function saveLog(entry) {
  const log = store.get('flightlog', []);
  log.unshift(entry);
  store.set('flightlog', log.slice(0, 200));
}
export function showLogbook() {
  const log = store.get('flightlog', []);
  const totMin = log.reduce((s, e) => s + (e.flightMin || 0), 0);
  const landed = log.filter(e => e.landingPts != null);
  const avg = landed.length ? Math.round(landed.reduce((s, e) => s + e.landingPts, 0) / landed.length) : '-';
  $('lbSum').innerHTML = `<span>비행 <b>${log.length}회</b></span><span>총 비행시간 <b>${Math.floor(totMin / 60)}시간 ${Math.round(totMin % 60)}분</b></span>` +
    `<span>착륙 <b>${landed.length}회</b> · 평균 <b>${avg}점</b></span>`;
  const head = ['날짜', '노선', '시작', '비행(분)', '연료(kg)', '착륙', '접지(fpm)', '평가', '등급'];
  $('lbTable').innerHTML = `<tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>` + (log.length ? log.map(e => `<tr>
    <td>${new Date(e.date).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
    <td>${e.route}</td><td>${e.start}</td><td>${e.flightMin != null ? Math.round(e.flightMin) : '-'}</td><td>${fmt(e.fuelUsed || 0)}</td>
    <td>${e.landingGrade ? e.landingGrade + ' ' + e.landingPts : '-'}</td><td>${e.fpm ?? '-'}</td><td>${e.overall}</td><td>${e.grade}</td></tr>`).join('')
    : `<tr><td colspan="9" class="muted">아직 기록이 없습니다.</td></tr>`);
  $('logbook').hidden = false;
}
export function exportCsv() {
  const log = store.get('flightlog', []);
  const head = ['날짜', '노선', '시작방식', '비행시간(분)', '블록시간(분)', '연료사용(kg)', '연료잔량(kg)', '최고고도(ft)', '착륙등급', '착륙점수', '접지강하율(fpm)', '복행', '운항점수', '등급', '비고'];
  const rows = log.map(e => [e.date, e.route, e.start, e.flightMin != null ? e.flightMin.toFixed(1) : '', e.blockMin?.toFixed(1) ?? '', e.fuelUsed, e.fuelRemain, e.maxAlt,
    e.landingGrade ?? '', e.landingPts ?? '', e.fpm ?? '', e.ga ?? 0, e.overall, e.grade, e.crashed ?? '']);
  const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `flight-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
export function clearLog() { if (confirm('비행 기록을 모두 지울까요?')) { store.set('flightlog', []); showLogbook(); } }
