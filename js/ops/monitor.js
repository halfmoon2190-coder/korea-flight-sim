// 비행 감시: 비행 단계 판별 · 위반/특이사항 기록 · 안정 접근 판정 · 운항 평가서
import { AC } from '../sim/a320.js';
import { KT, FT, NM, DEG } from '../sim/atmo.js';

export const PHASE_KO = {
  PREFLIGHT: '출발 준비', TAKEOFF: '이륙 활주', INITIAL_CLIMB: '초기 상승', CLIMB: '상승', CRUISE: '순항',
  DESCENT: '강하', APPROACH: '접근', FINAL: '최종 접근', ROLLOUT: '착륙 활주', TAXI: '정지/지상', DONE: '종료',
};

export class FlightMonitor {
  /**
   * ctx: { ac, ap, vr, vapp, depElevFt, destElevFt, cruiseFt, plan(연료 계획), route 정보, checklists }
   */
  constructor(ctx) {
    this.c = ctx;
    this.phase = ctx.ac.wow ? 'PREFLIGHT' : 'CRUISE';
    this.events = [];             // {t, phase, text, delta, cat}
    this.once = new Set();
    this.airborne = !ctx.ac.wow;
    this.startTime = ctx.ac.time;
    this.startFuel = ctx.ac.fuel;
    this.t = { takeoff: null, landing: null, stop: null };
    this.gates = {};
    this.lastWarn = new Set();
    this.maxAlt = ctx.ac.altFt;
    this.fast10k = 0;
    this.rotation = null; this.maxQ = 0;
    this.ga = 0;
    this.rto = false;
    this.done = false;
    this.stopTimer = 0;
  }

  add(cat, text, delta = 0, key = null) {
    if (key) { if (this.once.has(key)) return; this.once.add(key); }
    this.events.push({ t: this.c.ac.time - this.startTime, phase: this.phase, cat, text, delta });
  }

  setPhase(p) { if (p !== this.phase) { this.phase = p; } }

  update(dt, warnings, guide) {
    const { ac, ap } = this.c;
    if (this.done) return;
    this.maxAlt = Math.max(this.maxAlt, ac.altFt);
    const hDep = ac.altFt - (this.c.depElevFt || 0), hDest = ac.altFt - (this.c.destElevFt || 0);
    const toRwy = guide ? guide.toRwy / NM : 99;
    const vsFpm = ac.vs / FT * 60;

    /* ── 단계 판별 ── */
    if (ac.wow) {
      if (!this.airborne) {
        if (ac.gs > 30 * KT && ac.ctl.lever >= AC.detents.MCT - 0.01) this.setPhase('TAKEOFF');
        if (this.phase === 'TAKEOFF' && ac.ctl.lever < 0.05 && ac.gs > 40 * KT && !this.rto) { this.rto = true; this.add('takeoff', `이륙 중단(RTO) — ${Math.round(ac.ias)}kt에서 추력 IDLE`, 0); }
      } else {
        this.setPhase(ac.gs > 30 * KT ? 'ROLLOUT' : 'TAXI');
        if (ac.gs < 2 * KT) { this.stopTimer += dt; if (this.stopTimer > 3 && !this.t.stop) { this.t.stop = ac.time; this.finishRollout(); } } else this.stopTimer = 0;
      }
    } else {
      if (!this.airborne) { this.airborne = true; this.t.takeoff = ac.time; this.add('takeoff', `이륙 (${Math.round(ac.ias)}kt)`, 0); }
      if ((this.phase === 'TAKEOFF' || this.phase === 'INITIAL_CLIMB') && hDep < 1500) this.setPhase('INITIAL_CLIMB');
      else if (toRwy < 15 || (ac.ctl.flapLever >= 2 && hDest < 5000)) this.setPhase(hDest < 1000 ? 'FINAL' : 'APPROACH');
      else if (vsFpm > 500) this.setPhase('CLIMB');
      else if (vsFpm < -500) this.setPhase('DESCENT');
      else if (this.c.cruiseFt && ac.altFt > this.c.cruiseFt - 1500) this.setPhase('CRUISE');
    }
    this.c.checklists?.follow(this.phase);

    /* ── 이륙 ── */
    if (ac.wow && !this.airborne) {
      if (ac.pitch > 2) this.maxQ = Math.max(this.maxQ, ac.w.x / DEG);
      if (!this.rotation && ac.pitch > 3 && ac.gs > 50 * KT) {
        this.rotation = ac.ias;
        const vr = this.c.vr;
        if (ac.ias < vr - 5) this.add('takeoff', `이른 회전: ${Math.round(ac.ias)}kt (VR ${vr})`, -10);
        else if (ac.ias > vr + 15) this.add('takeoff', `늦은 회전: ${Math.round(ac.ias)}kt (VR ${vr})`, -5);
        else this.add('takeoff', `정확한 회전 속도: ${Math.round(ac.ias)}kt (VR ${vr})`, 0);
      }
    }
    if (this.airborne && this.t.takeoff && ac.time - this.t.takeoff < 2 && this.maxQ > 0 && !this.once.has('rotrate')) {
      this.once.add('rotrate');
      if (this.maxQ > 5) this.add('takeoff', `급한 회전 (초당 ${this.maxQ.toFixed(1)}°, 권장 3°)`, -8);
    }
    if (ac.tailStrike) this.add('takeoff', '꼬리 접촉 (TAIL STRIKE)', -30, 'tail');
    if (this.airborne && this.t.takeoff && hDep > 1000 && ac.gearPos > 0.9 && this.phase === 'INITIAL_CLIMB') this.add('takeoff', '랜딩기어 올림 지연 (1,000ft 이상)', -5, 'gearup');

    /* ── 비행 중 제한 ── */
    if (!ac.wow) {
      if (ac.altFt < 10000 && ac.ias > 260 && this.airborne && this.phase !== 'TAKEOFF') {
        this.fast10k += dt;
        if (this.fast10k > 15) this.add('flight', '10,000ft 이하 250kt 제한 초과', -5, '250-' + (this.phase === 'DESCENT' || this.phase === 'APPROACH' ? 'des' : 'clb'));
      } else this.fast10k = 0;
      if (Math.abs(ac.bank) > 40) this.add('flight', `과도한 경사각 (${Math.round(Math.abs(ac.bank))}°)`, -5, 'bank');
      if (ac.pitch > 25 || ac.pitch < -12) this.add('flight', `과도한 피치 (${Math.round(ac.pitch)}°)`, -5, 'pitch');
    }
    const cur = new Set(warnings.map(w => w.id));
    const pen = { STALL: ['flight', '실속 경고', -20], OVERSPEED: ['flight', '과속 경고', -8], TERRAIN: ['flight', '지형 접근 경고', -20], SINK: ['approach', '강하율 과다 경고', -5], GEAR: ['approach', '기어 미전개 경고', -10] };
    for (const id of cur) if (!this.lastWarn.has(id) && pen[id]) { const [cat, txt, d] = pen[id]; this.add(cat, txt, d); }
    this.lastWarn = cur;

    /* ── 안정 접근 판정 (1000ft / 500ft) ── */
    if (!ac.wow && this.airborne && vsFpm < 0 && toRwy < 8) {
      for (const g of [1000, 500]) {
        if (!this.gates[g] && hDest < g && hDest > g - 300) this.gates[g] = this.evalGate(g);
      }
    }
    // 복행 감지
    if (ap.ga && !this._ga) { this.ga++; this.add('approach', '복행(Go-around) 실시 — 안전한 판단', 0); this.gates = {}; }
    this._ga = ap.ga;
  }

  evalGate(g) {
    const { ac, ap, vapp } = this.c;
    const r = [];
    if (ac.gearPos < 0.98) r.push('기어 미전개');
    if (ac.ctl.flapLever < 3) r.push('플랩 착륙 위치 아님');
    if (ac.ias < vapp - 5) r.push(`속도 느림 (${Math.round(ac.ias)}kt)`);
    if (ac.ias > vapp + 15) r.push(`속도 빠름 (${Math.round(ac.ias)}kt)`);
    if (ac.vs / FT * 60 < -1100) r.push(`강하율 과다 (${Math.round(ac.vs / FT * 60)}fpm)`);
    if (ap.loc && ap.loc.u < 0) {
      if (Math.abs(ap.loc.locDev) > 0.8) r.push('활주로 정렬 벗어남');
      if (Math.abs(ap.loc.gsDev) > 0.7) r.push(ap.loc.gsDev > 0 ? '활공경로보다 높음' : '활공경로보다 낮음');
    }
    const ok = r.length === 0;
    this.add('approach', `${g}ft 안정 접근 ${ok ? '충족' : '미충족: ' + r.join(', ')}`, ok ? 0 : (g === 500 ? -10 : -5));
    return { ok, reasons: r };
  }

  onTouchdown(landing) {
    this.t.landing = this.c.ac.time;
    this.landing = landing;
    if (this.gates[500] && !this.gates[500].ok) this.add('landing', '500ft에서 불안정했는데도 착륙 (복행했어야 함)', -15);
  }

  finishRollout() {
    const { ac } = this.c;
    if (this.landing && this.c.landRwy) {
      const { rwy, end } = this.c.landRwy;
      const l = rwy.local(end, ac.pos), lt = rwy.local(end, this.c.ac.touchdown.pos);
      const roll = l.u - lt.u;
      this.rollDist = roll;
      if (Math.abs(l.v) > rwy.W / 2 || l.u > rwy.L) this.add('landing', '활주로 이탈', -25);
      else this.add('landing', `착륙 활주 ${Math.round(roll)}m 후 정지 (활주로 ${Math.round(rwy.L - l.u)}m 남음)`, 0);
    }
  }

  /** 운항 평가서 */
  report(extra = {}) {
    const { ac } = this.c;
    const cats = [
      { id: 'takeoff', name: '이륙' }, { id: 'flight', name: '상승 · 순항 · 강하' },
      { id: 'approach', name: '접근' }, { id: 'landing', name: '착륙' }, { id: 'proc', name: '절차 (체크리스트)' }, { id: 'fuel', name: '연료 관리' },
    ];
    const out = [];
    for (const c of cats) {
      const items = this.events.filter(e => e.cat === c.id);
      let score = 100 + items.reduce((s, e) => s + e.delta, 0);
      let applicable = items.length > 0;
      if (c.id === 'takeoff') applicable = this.t.takeoff !== null && this.c.startedOnGround;
      if (c.id === 'flight') applicable = this.airborne;
      if (c.id === 'approach') applicable = !!(this.gates[1000] || this.gates[500] || this.landing);
      if (c.id === 'landing') { applicable = !!this.landing; if (this.landing) score = Math.min(score, 100) - (100 - this.landing.pts); }
      if (c.id === 'proc') {
        const cl = this.c.checklists, total = this.c.expectedChecklists || [];
        const done = total.filter(id => cl?.done[id]);
        applicable = total.length > 0;
        score = total.length ? Math.round(100 * done.length / total.length) : 100;
        items.push({ text: `체크리스트 ${done.length}/${total.length} 완료`, delta: 0 });
      }
      if (c.id === 'fuel') {
        const fp = this.c.fuelPlan;
        applicable = !!(fp && this.landing);
        if (applicable) {
          const used = this.startFuel - ac.fuel;
          items.push({ text: `사용 ${Math.round(used)}kg (계획 ${fp.trip}kg) · 잔량 ${Math.round(ac.fuel)}kg`, delta: 0 });
          if (ac.fuel < fp.reserve) { items.push({ text: `최종 예비연료(${fp.reserve}kg) 침범`, delta: -30 }); score -= 30; }
          else if (ac.fuel < fp.reserve + fp.alternate) { items.push({ text: '교체공항 연료 일부 사용', delta: -5 }); score -= 5; }
          if (used > fp.trip * 1.25) { items.push({ text: '계획보다 연료를 25% 이상 더 사용', delta: -10 }); score -= 10; }
        }
      }
      score = Math.max(0, Math.min(100, Math.round(score)));
      if (applicable) out.push({ ...c, score, items });
    }
    const overall = out.length ? Math.round(out.reduce((s, c) => s + c.score, 0) / out.length) : 0;
    const crashed = !!ac.crashed;
    const total = crashed ? 0 : overall;
    const grade = crashed ? 'F' : total >= 90 ? 'A' : total >= 80 ? 'B' : total >= 65 ? 'C' : 'D';
    const flightMin = this.t.takeoff !== null && this.t.landing !== null ? (this.t.landing - this.t.takeoff) / 60 : null;
    const blockMin = ((this.t.stop || ac.time) - this.startTime) / 60;
    return {
      date: new Date().toISOString(), cats: out, overall: total, grade, crashed: ac.crashed || null,
      flightMin, blockMin, fuelUsed: Math.round(this.startFuel - ac.fuel), fuelRemain: Math.round(ac.fuel),
      maxAlt: Math.round(this.maxAlt), ga: this.ga, landing: this.landing || null, rollDist: this.rollDist || null,
      events: this.events, ...extra,
    };
  }
}
