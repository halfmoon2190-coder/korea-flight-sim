// 자동비행 검증:  node tools/aptest.js [--route]
import fs from 'fs';
import path from 'path';
import { Vector3 } from '../vendor/three.module.min.js';
import { Aircraft } from '../js/sim/aircraft.js';
import { Autopilot } from '../js/sim/autopilot.js';
import { FlightPlan } from '../js/nav/fms.js';
import { KT, FT, NM, DEG, wrap180 } from '../js/sim/atmo.js';

const DT = 1 / 120;
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail !== undefined ? ' — ' + detail : ''}`); if (!ok) failures++; };
const fpm = (ac) => ac.vs / FT * 60;
const line = (ac, ap, extra = '') => console.log(
  `t=${ac.time.toFixed(0).padStart(5)} ALT=${ac.altFt.toFixed(0).padStart(6)} RA=${ac.raFt.toFixed(0).padStart(6)} IAS=${ac.ias.toFixed(0).padStart(3)} VS=${fpm(ac).toFixed(0).padStart(6)} HDG=${ac.dispHeading.toFixed(0).padStart(3)} ` +
  `B=${ac.bank.toFixed(0).padStart(3)} N1=${ac.n1.toFixed(0)} ${ap.thrMode}|${ap.vert}|${ap.lat} ${extra}`);

/** 간이 활주로 객체 (runway.js와 같은 좌표 규칙, DOM 없음) */
function makeRunway({ x, z, hdg, length, width, names, elev = 0 }) {
  const h = hdg * DEG, dir = new Vector3(Math.sin(h), 0, -Math.cos(h));
  const c = new Vector3(x, elev, z);
  const thrA = c.clone().addScaledVector(dir, -length / 2), thrB = c.clone().addScaledVector(dir, length / 2);
  return {
    L: length, W: width, center: c, dir,
    ends: [{ name: names[0], thr: thrA, dir: dir.clone(), hdg }, { name: names[1], thr: thrB, dir: dir.clone().negate(), hdg: (hdg + 180) % 360 }],
    local(end, pos) {
      const d = new Vector3().subVectors(pos, end.thr), r = new Vector3(-end.dir.z, 0, end.dir.x);
      return { u: d.x * end.dir.x + d.z * end.dir.z, v: d.x * r.x + d.z * r.z };
    },
  };
}

function run(ac, ap, seconds, hook, logEvery = 20) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    hook?.(ac, ap, i * DT);
    ap.update(DT);
    ac.step(DT);
    if (logEvery && i % Math.round(logEvery / DT) === 0) line(ac, ap);
    if (ac.crashed) { console.log('CRASH', ac.crashed); return false; }
    if (hook?.done?.(ac, ap)) break;
  }
  return true;
}

/* 1. 상승 · 선회 · 고도 포착 */
console.log('\n=== 1. AP 상승(OP CLB) + 방위 변경 + 고도 포착 ===');
{
  const ac = new Aircraft(); const ap = new Autopilot(ac);
  ac.placeInAir(0, 5000 * FT, 0, 330, 250, 0, 0, false);
  ac.ctl.lever = 0.5; ap.toggleATHR();
  ap.toggleAP();
  ap.fcu.hdg = 90; ap.pullHdg();
  ap.fcu.alt = 11000; ap.pullAlt();
  run(ac, ap, 240, null, 30);
  check('방위 090 도달', Math.abs(wrap180(ac.dispHeading - 90)) < 3, ac.dispHeading.toFixed(0));
  check('고도 11000 포착', Math.abs(ac.altFt - 11000) < 80, ac.altFt.toFixed(0));
  check('모드 ALT', ap.vert === 'ALT', ap.vert);
  const tgt = ap.spdTarget;
  check('관리 속도 유지 (±8kt)', Math.abs(ac.ias - tgt) < 8, `${ac.ias.toFixed(0)} / ${tgt.toFixed(0)}`);
  // 강하
  ap.fcu.alt = 4000; ap.pullAlt();
  run(ac, ap, 480, null, 60);
  check('강하 후 4000 포착', Math.abs(ac.altFt - 4000) < 80, ac.altFt.toFixed(0));
  check('속도 250 부근', Math.abs(ac.ias - 250) < 10, ac.ias.toFixed(0));
  // V/S
  ap.fcu.vs = 1000; ap.setVert('V/S'); ap.fcu.alt = 6000;
  run(ac, ap, 30, null, 10);
  check('V/S +1000 추종', Math.abs(fpm(ac) - 1000) < 150, fpm(ac).toFixed(0));
}

/* 2. ILS 접근 + 자동착륙 (연습 활주로) */
console.log('\n=== 2. ILS 포착 + 자동착륙 (연습 공항 33L) ===');
{
  const rwy = makeRunway({ x: 0, z: 0, hdg: 330, length: 3750, width: 60, names: ['33L', '15R'] });
  const end = rwy.ends[0];
  const ac = new Aircraft(); const ap = new Autopilot(ac);
  // 13NM, 왼쪽 2NM 옆, 3000ft, 300° 방향으로 진입
  const rt = new Vector3(-end.dir.z, 0, end.dir.x);
  const p = end.thr.clone().addScaledVector(end.dir, -13 * NM).addScaledVector(rt, -2.0 * NM);
  ac.placeInAir(p.x, 3000 * FT + 2.9, p.z, 355, 220, 0, 1, false);
  ac.ctl.lever = 0.5; ap.toggleATHR(); ap.toggleAP();
  ap.fcu.alt = 3000; ap.setVert('ALT');
  ap.fcu.hdg = 355; ap.pullHdg();
  ap.app = { rwy, end };
  ap.armAppr();
  let caps = {};
  const ok = run(ac, ap, 600, Object.assign((a, A) => {
    const l = rwy.local(end, a.pos), d = -l.u / NM;
    if (A.lat === 'LOC*' && !caps.loc) caps.loc = d.toFixed(1);
    if (A.vert === 'G/S*' && !caps.gs) caps.gs = d.toFixed(1);
    if (d < 11 && a.ctl.flapLever < 2) a.ctl.flapLever = 2;
    if (d < 8 && !a.ctl.gearDown) a.ctl.gearDown = true;
    if (d < 7 && a.ctl.flapLever < 3) a.ctl.flapLever = 3;
    if (d < 6 && a.ctl.flapLever < 4) a.ctl.flapLever = 4;
    if (a.wow) a.ctl.brake = a.wowTime > 3 ? 0.5 : 0;
  }, { done: (a) => a.wow && a.gs < 20 * KT }), 30);
  const td = ac.touchdown;
  const l = td ? rwy.local(end, td.pos) : null;
  console.log('captures', caps, 'touchdown', td && { fpm: td.fpm.toFixed(0), u: l.u.toFixed(0), v: l.v.toFixed(1), pitch: td.pitch.toFixed(1), ias: td.ias.toFixed(0) });
  check('LOC 포착', !!caps.loc, caps.loc + 'NM');
  check('G/S 포착', !!caps.gs, caps.gs + 'NM');
  check('자동착륙 접지', ok && !!td);
  check('접지 강하율 < 360fpm', td && td.fpm < 360, td && td.fpm.toFixed(0));
  check('중심선 ±5m', l && Math.abs(l.v) < 5, l && l.v.toFixed(1));
  check('접지구역 150~900m', l && l.u > 150 && l.u < 900, l && l.u.toFixed(0));
}

/* 3. 실제 노선 (지형 포함): RKSI 33L → RKPK 36L */
if (process.argv.includes('--route')) {
  console.log('\n=== 3. 노선 비행 RKSI 33L → RKPK 36L (FMS · AP · 자동착륙) ===');
  const { PNG } = await import('pngjs');
  const { Terrain } = await import('../js/world/terrain.js');
  const { AIRPORTS } = await import('../js/geo/airports.js');
  const { toWorld } = await import('../js/geo/proj.js');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'data/terrain/meta.json')));
  const grids = meta.grids.map(g => {
    const png = PNG.sync.read(fs.readFileSync(path.join(root, 'data/terrain', g.file)));
    const data = new Float32Array(png.width * png.height);
    for (let i = 0; i < data.length; i++) data[i] = (png.data[i * 4] * 256 + png.data[i * 4 + 1]) / meta.scale - meta.offset;
    return { ...g, data };
  });
  const aps = AIRPORTS.map(a => {
    const elev = a.elevFt * FT;
    const runways = a.runways.map(r => {
      const A = toWorld(...r.a), B = toWorld(...r.b), L = Math.hypot(B.x - A.x, B.z - A.z);
      const dir = { x: (B.x - A.x) / L, z: (B.z - A.z) / L };
      return { ...r, A, B, dir, center: { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 }, hdg: (Math.atan2(dir.x, -dir.z) / DEG + 360) % 360, L: r.lenFt * FT, W: r.widFt * FT };
    });
    const terminals = a.terminals.map(t => { const r = runways.find(x => x.le === t.ref); const rt = { x: -r.dir.z, z: r.dir.x }; return { ...t, center: { x: r.center.x + r.dir.x * t.u + rt.x * t.v, z: r.center.z + r.dir.z * t.u + rt.z * t.v }, dir: r.dir, rt }; });
    return { ...a, geo: { elev, runways, terminals } };
  });
  const terrain = new Terrain({ grids }, aps);
  const world = { groundAt: (x, z) => terrain.groundAt(x, z) };
  const rwyOf = (icao, name) => {
    const a = aps.find(x => x.icao === icao);
    for (const r of a.geo.runways) {
      const o = makeRunway({ x: r.center.x, z: r.center.z, hdg: r.hdg, length: r.L, width: r.W, names: [r.le, r.he], elev: a.geo.elev });
      for (const e of o.ends) if (e.name === name) return { rwy: o, end: e };
    }
  };
  const dep = rwyOf('RKSI', '33L'), dst = rwyOf('RKPK', '36L');
  const ac = new Aircraft(world.groundAt); ac.isWater = (x, z) => terrain.isWater(x, z);
  const ap = new Autopilot(ac);
  const p0 = dep.end.thr.clone().addScaledVector(dep.end.dir, 70);
  ac.placeOnGround(p0.x, p0.z, dep.end.hdg);
  ac.ctl.parking = false;
  const plan = new FlightPlan(world, { start: { x: p0.x, z: p0.z, alt: dep.end.thr.y }, depEnd: dep.end, end: dst.end, destName: 'RKPK' });
  console.log('plan', plan.wps.map(w => `${w.name}${w.alt ? '@' + Math.round(w.alt / FT) : ''}`).join(' → '), 'cruise', Math.round(plan.cruiseAlt / FT), 'total', (plan.totalToRwy / NM).toFixed(0) + 'NM');
  ap.plan = plan; ap.app = dst; ap.fcu.alt = Math.round(plan.cruiseAlt / FT / 100) * 100;
  ap.speeds = ac.speeds();
  let phase = 'to', desStarted = false, maxXte = 0;
  const ok = run(ac, ap, 3600 * 1.2, Object.assign((a, A, t) => {
    const sp = A.speeds;
    if (phase === 'to') { a.ctl.lever = 1; if (a.ias > sp.vr) a.ctl.pitch = 0.6; if (!a.wow && a.raFt > 20) { phase = 'air'; a.ctl.pitch = 0; } }
    if (phase === 'air' && a.raFt > 120 && !A.ap) { a.ctl.gearDown = false; A.toggleAP(); }
    if (A.ap && a.raFt > 1600 && a.ctl.lever > 0.5) a.ctl.lever = 0.5;
    if (a.raFt > 2500 && a.ctl.flapLever > 0 && !desStarted) a.ctl.flapLever = 0;   // 가속 고도에서 플랩 올림
    const g = A.lastGuide;
    if (g && A.lat === 'NAV' && a.altFt > 15000) maxXte = Math.max(maxXte, Math.abs(g.xte));
    if (g && !desStarted && plan.todDistance(g.s) < 0) { desStarted = true; A.fcu.alt = Math.round(plan.iafAlt / FT / 100) * 100; A.pushAlt(); }
    if (g && g.toRwy < 25 * NM && !A.armed.gs && !['G/S', 'G/S*', 'LAND', 'FLARE', 'ROLL OUT'].includes(A.vert)) A.armAppr();
    const d = g ? g.toRwy / NM : 99;
    if (d < 18 && a.ctl.flapLever < 1) a.ctl.flapLever = 1;
    if (d < 13 && a.ctl.flapLever < 2) a.ctl.flapLever = 2;
    if (d < 10 && !a.ctl.gearDown) a.ctl.gearDown = true;
    if (d < 8 && a.ctl.flapLever < 3) a.ctl.flapLever = 3;
    if (d < 6.5 && a.ctl.flapLever < 4) a.ctl.flapLever = 4;
    if (a.wow && phase === 'air') a.ctl.brake = a.wowTime > 3 ? 0.5 : 0;
  }, { done: (a) => a.wow && a.gs < 20 * KT && a.time > 300 }), 180);
  const td = ac.touchdown;
  const l = td ? dst.rwy.local(dst.end, td.pos) : null;
  console.log('touchdown', td && { fpm: td.fpm.toFixed(0), u: l.u.toFixed(0), v: l.v.toFixed(1), min: (td.time / 60).toFixed(1) });
  check('노선 완주 (추락 없음)', ok && !ac.crashed, ac.crashed || '');
  check('NAV 횡오차 최대 < 2NM (순항)', maxXte < 2 * NM, (maxXte / NM).toFixed(2) + 'NM');
  check('김해 36L 자동착륙', !!td && l && Math.abs(l.v) < 8 && l.u > 0 && l.u < 1200, l && `${l.u.toFixed(0)}m / ${l.v.toFixed(1)}m`);
}

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 모든 자동비행 검증 통과');
process.exit(failures ? 1 : 0);
