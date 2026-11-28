// 관제(ATC): 비행 단계에 따라 허가 · 지시를 발부 (영어 음성 + 한글 자막). 주파수는 가상 값
import { FT, NM, KT } from '../sim/atmo.js';

const FACIL = {
  RKSI: { name: 'Incheon', ko: '인천', twr: '118.2', dep: '119.75', app: '119.1', gnd: '121.9' },
  RKPK: { name: 'Gimhae', ko: '김해', twr: '118.1', dep: '125.5', app: '125.5', gnd: '121.9' },
  RKPC: { name: 'Jeju', ko: '제주', twr: '118.0', dep: '121.2', app: '121.2', gnd: '121.7' },
  TRNG: { name: 'Practice', ko: '연습', twr: '118.5', dep: '120.0', app: '120.0', gnd: '121.8' },
};
const CENTER = { name: 'Incheon Control', ko: '인천 컨트롤', f: '132.0' };

const altSay = (ft) => ft >= 18000 ? { en: `flight level ${Math.round(ft / 100)}`, ko: `FL${Math.round(ft / 100)}` } : { en: `${ft.toLocaleString('en-US')} feet`, ko: `${ft.toLocaleString('ko-KR')}ft` };
const rwySay = (r) => r.replace('L', ' left').replace('R', ' right').replace('C', ' center');

export class ATC {
  constructor({ say, onMsg, onDeviation }) {
    this.say = say; this.onMsg = onMsg; this.onDeviation = onDeviation;
    this.enabled = true;
    this.log = [];
  }

  start(ctx) {
    // ctx: { cs, dep, dest, depRwy, destRwy, start, cruiseFt, iafFt, wxText(icao), wxEn(icao) }
    this.c = ctx;
    this.log = [];
    this.step = { takeoff: false, dep: false, climb: false, center: false, descent: false, app: false, twr: false, land: false, vacate: false };
    this.assigned = null; this.devT = 0; this.queue = []; this.t = 0;
    this.takeoffCleared = false; this.landCleared = false;
    if (ctx.start === 'cruise') { this.step.takeoff = this.step.dep = this.step.climb = true; this.assigned = ctx.cruiseFt; }
    if (ctx.start === 'app12' || ctx.start === 'final12' || ctx.start === 'circuit' || ctx.start === 'free') {
      Object.assign(this.step, { takeoff: true, dep: true, climb: true, center: true, descent: true });
    }
    if (ctx.start === 'final4') Object.assign(this.step, { takeoff: true, dep: true, climb: true, center: true, descent: true, app: true });
  }

  msg(from, en, ko, readEn = null, delay = 0) { this.queue.push({ at: this.t + delay, from, en, ko, readEn }); }

  update(dt, ac, ap, phase, guide, plan) {
    if (!this.c || !this.enabled) return;
    this.t += dt;
    const c = this.c, D = FACIL[c.dep] || FACIL.TRNG, A = FACIL[c.dest] || FACIL.TRNG, cs = c.cs;
    const s = this.step;
    // 이륙 허가
    if (!s.takeoff && ac.wow && this.t > 3) {
      s.takeoff = true; this.takeoffCleared = true;
      this.msg(`${D.ko} 타워 ${D.twr}`, `${cs}, ${D.name} Tower, wind ${c.wxEn(c.dep)}, runway ${rwySay(c.depRwy)}, cleared for takeoff.`,
        `${c.wxText(c.dep)}, 활주로 ${c.depRwy} 이륙을 허가합니다.`, `Cleared for takeoff runway ${rwySay(c.depRwy)}, ${cs}.`);
    }
    const hDep = ac.altFt - (c.depElevFt || 0);
    if (s.takeoff && !s.dep && !ac.wow && hDep > 1000) {
      s.dep = true;
      this.msg(`${D.ko} 타워`, `${cs}, contact ${D.name} Departure ${D.dep}. Good day.`, `${D.ko} 출발관제(${D.dep})로 교신하세요.`, `${D.name} Departure ${D.dep}, ${cs}.`);
      const a = altSay(c.cruiseFt);
      this.assigned = c.cruiseFt;
      this.msg(`${D.ko} 출발관제 ${D.dep}`, `${cs}, ${D.name} Departure, radar contact. Climb and maintain ${a.en}, proceed on course.`,
        `레이더 포착. ${a.ko}까지 상승해 계획 경로로 비행하세요.`, `Climb and maintain ${a.en}, ${cs}.`, 6);
    }
    if (s.dep && !s.center && ac.altFt > Math.min(18000, c.cruiseFt - 2000)) {
      s.center = true;
      this.msg(`${D.ko} 출발관제`, `${cs}, contact ${CENTER.name} ${CENTER.f}.`, `${CENTER.ko}(${CENTER.f})로 교신하세요.`, `${CENTER.f}, ${cs}.`);
      this.msg(`${CENTER.ko} ${CENTER.f}`, `${cs}, ${CENTER.name}, roger, maintain ${altSay(c.cruiseFt).en}.`, `${altSay(c.cruiseFt).ko}를 유지하세요.`, null, 5);
    }
    // 강하 허가: 강하 시작점 10NM 전
    if (s.center && !s.descent && plan && guide && plan.todDistance(guide.s) < 10 * NM) {
      s.descent = true;
      const a = altSay(c.iafFt);
      this.assigned = c.iafFt;
      this.msg(`${CENTER.ko}`, `${cs}, descend and maintain ${a.en}, expect ILS approach runway ${rwySay(c.destRwy)} at ${A.name}.`,
        `${a.ko}까지 강하하세요. ${A.ko} 활주로 ${c.destRwy} ILS 접근 예정.`, `Descend and maintain ${a.en}, ${cs}.`);
    }
    // 접근 허가
    if (s.descent && !s.app && guide && guide.toRwy < 30 * NM) {
      s.app = true;
      this.msg(`${CENTER.ko}`, `${cs}, contact ${A.name} Approach ${A.app}.`, `${A.ko} 접근관제(${A.app})로 교신하세요.`, `${A.app}, ${cs}.`);
      this.msg(`${A.ko} 접근관제 ${A.app}`, `${cs}, ${A.name} Approach, maintain ${altSay(c.iafFt).en} until established, cleared ILS runway ${rwySay(c.destRwy)} approach.`,
        `로컬라이저에 정렬될 때까지 ${altSay(c.iafFt).ko} 유지, 활주로 ${c.destRwy} ILS 접근을 허가합니다.`, `Cleared ILS runway ${rwySay(c.destRwy)}, ${cs}.`, 6);
    }
    // 착륙 허가
    const onFinal = guide && guide.toRwy < 9 * NM || ['G/S', 'LAND', 'FLARE'].includes(ap.vert);
    if (s.app && !s.twr && onFinal && !ac.wow) {
      s.twr = true; this.assigned = null;
      this.msg(`${A.ko} 접근관제`, `${cs}, contact ${A.name} Tower ${A.twr}.`, `${A.ko} 타워(${A.twr})로 교신하세요.`, `Tower ${A.twr}, ${cs}.`);
      this.msg(`${A.ko} 타워 ${A.twr}`, `${cs}, ${A.name} Tower, wind ${c.wxEn(c.dest)}, runway ${rwySay(c.destRwy)}, cleared to land.`,
        `${c.wxText(c.dest)}, 활주로 ${c.destRwy} 착륙을 허가합니다.`, `Cleared to land runway ${rwySay(c.destRwy)}, ${cs}.`, 5);
      this.landCleared = true;
    }
    if (s.twr && !s.vacate && ac.wow && ac.gs < 40 * KT) {
      s.vacate = true;
      this.msg(`${A.ko} 타워`, `${cs}, vacate runway at the next taxiway, contact Ground ${A.gnd}.`, `다음 유도로로 활주로를 벗어나 지상관제(${A.gnd})로 교신하세요.`, `Ground ${A.gnd}, ${cs}.`);
    }
    // 복행
    if (ap.ga && !this._ga) {
      this.assigned = 3000 + Math.round((c.destElevFt || 0) / 100) * 100;
      this.msg(`${A.ko} 타워`, `${cs}, roger, go around. Fly runway heading, climb and maintain ${altSay(this.assigned).en}.`,
        `복행 확인. 활주로 방향으로 ${altSay(this.assigned).ko}까지 상승하세요.`, `Runway heading, ${altSay(this.assigned).en}, ${cs}.`);
      s.twr = false; s.app = true; this.landCleared = false;
    }
    this._ga = ap.ga;

    // 지시 고도 감시 (±300ft를 30초 넘게 벗어나면)
    if (this.assigned !== null && !ac.wow) {
      // 지시 고도로 향해 상승·강하 중이면 정상, 그 외에 ±300ft 밖이면 이탈
      const vsFpm = ac.vs / FT * 60;
      const above = ac.altFt > this.assigned + 300, below = ac.altFt < this.assigned - 300;
      if (this._lastAssigned !== this.assigned) { this._lastAssigned = this.assigned; this.reached = false; }
      if (!above && !below) this.reached = true;
      const away = (above && vsFpm > 300) || (below && vsFpm < -300);
      // 지시 고도에 도달한 뒤 벗어나거나, 도달 전이라도 반대 방향으로 움직이면 이탈
      const dev = (above || below) && (this.reached || away);
      this.devT = dev ? this.devT + dt : 0;
      if (this.devT > 30) { this.devT = -600; this.onDeviation?.(`관제 지시 고도(${altSay(this.assigned).ko}) 이탈`); this.msg('관제', `${cs}, check altitude, maintain ${altSay(this.assigned).en}.`, `고도를 확인하세요. ${altSay(this.assigned).ko} 유지.`); }
    }

    // 송출
    while (this.queue.length && this.queue[0].at <= this.t) {
      const m = this.queue.shift();
      this.log.push(m);
      this.onMsg?.(m);
      this.say?.(m.en);
    }
  }
}
