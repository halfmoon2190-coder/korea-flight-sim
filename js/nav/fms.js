// 간이 FMS: 경로(경유지) 생성 · 레그 진행 · 횡오차 · 수직 프로파일
// 좌표는 월드(x 동, z 남), 고도는 m (해수면 기준)
const NM = 1852, FT = 0.3048, D = Math.PI / 180;
const TAN3 = Math.tan(3 * D), TAN_CLB = Math.tan(4 * D);
const TAN_DES = Math.tan(2.7 * D);        // 순항 강하 경로각
const DECEL = 8 * NM;                       // 접근 시작점 전 감속 · 수평 구간
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const crsOf = (ax, az, bx, bz) => (Math.atan2(bx - ax, -(bz - az)) / D + 360) % 360;

export function cruiseAltFor(distNm) {
  if (distNm > 200) return 28000 * FT;
  if (distNm > 120) return 24000 * FT;
  if (distNm > 60) return 16000 * FT;
  return 8000 * FT;
}

function maxTerrain(world, x, z, r) {
  let m = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) m = Math.max(m, world.groundAt(x + i * r / 4, z + j * r / 4));
  return m;
}

export class FlightPlan {
  /**
   * world: 월드 (groundAt 필요), end: 도착 활주로 끝 {thr, dir, hdg, name}
   * start: {x, z, alt} 시작점(출발 활주로 시단 또는 현재 위치), depEnd: 출발 활주로 끝(선택)
   */
  constructor(world, { start, depEnd, end, destName, cruiseAlt }) {
    this.end = end;
    this.destName = destName || '';
    const elevD = end.thr.y;
    const wps = [];
    // 출발: 활주로 방향으로 6NM
    let from = { x: start.x, z: start.z };
    if (depEnd) {
      const p = { x: depEnd.thr.x + depEnd.dir.x * (6 * NM + 1500), z: depEnd.thr.z + depEnd.dir.z * (6 * NM + 1500) };
      wps.push({ name: 'DEP', ...p, alt: null, kind: 'dep' });
      from = p;
    }
    // 접근 경유지 (12NM / 5NM / 시단)
    const at = (d, lat = 0) => {
      const rt = { x: -end.dir.z, z: end.dir.x };
      return { x: end.thr.x - end.dir.x * d + rt.x * lat, z: end.thr.z - end.dir.z * d + rt.z * lat };
    };
    const iaf = at(12 * NM);
    let iafAlt = elevD + 3000 * FT;
    iafAlt = Math.max(iafAlt, maxTerrain(world, iaf.x, iaf.z, 5 * NM) + 1000 * FT);
    iafAlt = Math.ceil(iafAlt / (100 * FT)) * 100 * FT;
    // 진입 각도가 크면 기저(BASE) 경유지 추가
    const cIn = crsOf(from.x, from.z, iaf.x, iaf.z);
    const diff = wrap180(end.hdg - cIn);
    const distToIaf = Math.hypot(iaf.x - from.x, iaf.z - from.z);
    if (Math.abs(diff) > 60 && distToIaf > 3 * NM) {
      const rt = { x: -end.dir.z, z: end.dir.x };
      const side = Math.sign((from.x - end.thr.x) * rt.x + (from.z - end.thr.z) * rt.z) || 1;
      const b = at(17 * NM, side * 7 * NM);
      const bAlt = Math.max(iafAlt, Math.ceil((maxTerrain(world, b.x, b.z, 5 * NM) + 1000 * FT) / (100 * FT)) * 100 * FT);
      wps.push({ name: 'BASE', ...b, alt: bAlt, kind: 'enr' });
    }
    wps.push({ name: 'IAF', ...iaf, alt: iafAlt, kind: 'iaf' });
    const faf = at(5 * NM);
    wps.push({ name: 'FAF', ...faf, alt: elevD + 15 + TAN3 * 5 * NM, kind: 'faf' });
    wps.push({ name: 'RW' + end.name, x: end.thr.x, z: end.thr.z, alt: elevD + 15, kind: 'rwy' });
    // 활주로 너머 (복행 대비 직진)
    const past = { x: end.thr.x + end.dir.x * 5 * NM, z: end.thr.z + end.dir.z * 5 * NM };
    wps.push({ name: 'MAP', ...past, alt: null, kind: 'map' });

    this.origin = { x: start.x, z: start.z, alt: start.alt };
    this.wps = wps;
    this.iafAlt = iafAlt;
    // 누적 거리
    let px = start.x, pz = start.z, s = 0;
    for (const w of wps) { s += Math.hypot(w.x - px, w.z - pz); w.cum = s; w.crs = crsOf(px, pz, w.x, w.z); px = w.x; pz = w.z; }
    this.rwyIdx = wps.findIndex(w => w.kind === 'rwy');
    this.iafIdx = wps.findIndex(w => w.kind === 'iaf');
    this.totalToRwy = wps[this.rwyIdx].cum;
    this.cruiseAlt = cruiseAlt ?? cruiseAltFor((this.totalToRwy) / NM);
    this.cruiseAlt = Math.max(this.cruiseAlt, iafAlt + 1000 * FT);
    this.startAlt = start.alt;
    this.active = 0;
  }

  prevPoint(i) { return i === 0 ? this.origin : this.wps[i - 1]; }

  /** 경유지 진행 + 유도 정보 */
  update(ac) {
    const p = ac.pos;
    // 레그 진행: 남은 거리가 선회 예측 거리보다 짧아지면 다음으로
    for (let guard = 0; guard < 3 && this.active < this.wps.length - 1; guard++) {
      const a = this.prevPoint(this.active), b = this.wps[this.active], c = this.wps[this.active + 1];
      const lx = b.x - a.x, lz = b.z - a.z, L = Math.hypot(lx, lz) || 1;
      const along = ((p.x - a.x) * lx + (p.z - a.z) * lz) / L;
      const turn = Math.abs(wrap180(c.crs - b.crs));
      const V = Math.max(60, ac.gs);
      const R = V * V / (9.81 * Math.tan(25 * D));
      const antic = Math.min(4 * NM, R * Math.tan(Math.min(150, turn) * D / 2));
      if (along > L - Math.max(300, antic)) this.active++;
      else break;
    }
    return this.guidance(ac);
  }

  guidance(ac) {
    const p = ac.pos;
    const i = this.active;
    const a = this.prevPoint(i), b = this.wps[i];
    const lx = b.x - a.x, lz = b.z - a.z, L = Math.hypot(lx, lz) || 1;
    const ux = lx / L, uz = lz / L;
    const rx = p.x - a.x, rz = p.z - a.z;
    const along = rx * ux + rz * uz;
    const xte = rx * (-uz) + rz * ux;            // 경로 오른쪽 +
    const crs = (Math.atan2(ux, -uz) / D + 360) % 360;
    const distToWp = Math.hypot(b.x - p.x, b.z - p.z);
    const sNow = (i === 0 ? 0 : this.wps[i - 1].cum) + Math.max(0, Math.min(L, along));
    const toRwy = Math.max(0, this.totalToRwy - sNow);
    return { i, wp: b, crs, xte, along, legLen: L, distToWp, s: sNow, toRwy, profileAlt: this.profileAlt(sNow), crsNext: this.wps[Math.min(i + 1, this.wps.length - 1)].crs };
  }

  /** 경로 거리 s(m)에서의 계획 고도(m) */
  profileAlt(s) {
    const r = Math.max(0, this.totalToRwy - s);
    const rIaf = this.totalToRwy - this.wps[this.iafIdx].cum;
    const elev = this.end.thr.y;
    const glide = elev + 15 + TAN3 * r;
    const des = r <= rIaf ? Math.min(this.iafAlt, glide) : this.iafAlt + TAN_DES * Math.max(0, r - rIaf - DECEL);
    const clb = this.startAlt + TAN_CLB * s;
    return Math.min(this.cruiseAlt, clb, des);
  }

  /** 강하 시작점까지 남은 거리(m) — 음수면 이미 지남 */
  todDistance(s) {
    const rIaf = this.totalToRwy - this.wps[this.iafIdx].cum;
    const rTod = rIaf + DECEL + (this.cruiseAlt - this.iafAlt) / TAN_DES;
    return (this.totalToRwy - s) - rTod;
  }

  /** 3D 가이드 · ND용 경로 점들 (간격 m) */
  samplePath(step = NM) {
    const pts = [];
    let px = this.origin.x, pz = this.origin.z, s0 = 0;
    for (let i = 0; i <= this.rwyIdx; i++) {
      const w = this.wps[i];
      const L = Math.hypot(w.x - px, w.z - pz);
      for (let d = 0; d < L; d += step) {
        const t = d / L;
        pts.push({ x: px + (w.x - px) * t, z: pz + (w.z - pz) * t, s: s0 + d });
      }
      s0 += L; px = w.x; pz = w.z;
    }
    pts.push({ x: px, z: pz, s: s0 });
    for (const q of pts) q.alt = this.profileAlt(q.s);
    return pts;
  }
}
