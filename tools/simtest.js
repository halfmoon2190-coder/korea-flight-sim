// 헤드리스 비행 물리 검증:  node tools/simtest.js
import { Aircraft } from '../js/sim/aircraft.js';
import { KT, FT, NM, DEG } from '../js/sim/atmo.js';

const DT = 1 / 120;
const fmt = (ac) =>
  `t=${ac.time.toFixed(1).padStart(5)} IAS=${ac.ias.toFixed(0).padStart(3)} ALT=${ac.altFt.toFixed(0).padStart(5)} RA=${ac.raFt.toFixed(0).padStart(5)} ` +
  `VS=${(ac.vs / FT * 60).toFixed(0).padStart(5)} P=${ac.pitch.toFixed(1).padStart(5)} B=${ac.bank.toFixed(1).padStart(5)} ` +
  `HDG=${ac.heading.toFixed(0).padStart(3)} a=${(ac.alpha / DEG).toFixed(1).padStart(5)} nz=${ac.nz.toFixed(2)} ` +
  `N1=${ac.n1.toFixed(0)} THS=${(ac.ths / DEG).toFixed(1)} EL=${(ac.elev / DEG).toFixed(1)} ${ac.law}${ac.wow ? ' WOW' : ''}`;

let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++; };

function run(ac, seconds, ctl, logEvery = 2) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (ctl) ctl(ac);
    ac.step(DT);
    if (logEvery && i % Math.round(logEvery / DT) === 0) console.log(fmt(ac));
    if (ac.crashed) { console.log('CRASH:', ac.crashed); break; }
  }
}

/* 1. 이륙 */
console.log('\n=== 1. 이륙 (64t, 1+F, TOGA) ===');
{
  const ac = new Aircraft();
  ac.placeOnGround(0, 0, 330);
  const sp = ac.speeds();
  console.log('V-speeds', sp);
  run(ac, 2, null, 1);
  ac.ctl.parking = false; ac.ctl.lever = 1;
  const start = ac.pos.clone();
  let vrDist = null, loDist = null, phase = 'roll', gearUpAt = null, maxPitch = 0;
  run(ac, 90, (a) => {
    const dist = a.pos.distanceTo(start);
    if (phase === 'roll' && a.ias >= sp.vr) { phase = 'rotate'; vrDist = dist; }
    if (phase === 'rotate') { a.ctl.pitch = 0.7; if (a.pitch > 12) phase = 'climb'; }
    if (phase === 'climb') a.ctl.pitch = Math.max(-0.5, Math.min(0.6, (16 - a.pitch) * 0.08));
    if (!a.wow && loDist === null && a.airTime > 0.2) loDist = dist;
    if (!a.wow && a.raFt > 50 && a.ctl.gearDown) { a.ctl.gearDown = false; gearUpAt = a.time; }
    if (a.raFt > 1500 && a.ctl.lever > 0.5) a.ctl.lever = 0.5;
    if (a.ias > 200 && a.ctl.flapLever > 0) a.ctl.flapLever = 0;
    maxPitch = Math.max(maxPitch, a.pitch);
  }, 4);
  check('VR 도달 거리 700~1800m', vrDist > 700 && vrDist < 1800, `${vrDist?.toFixed(0)} m`);
  check('이륙(부양) 거리 < 2300m', loDist && loDist < 2300, `${loDist?.toFixed(0)} m`);
  check('테일스트라이크 없음', !ac.tailStrike);
  check('최대 피치 < 25°', maxPitch < 25, maxPitch.toFixed(1) + '°');
  check('상승 중 (고도 > 2500ft)', ac.altFt > 2500, ac.altFt.toFixed(0) + ' ft');
  check('추락 없음', !ac.crashed, ac.crashed || '');
}

/* 2. 순항: 조종간 중립 시 비행경로 유지, 롤 입력 후 경사 유지 */
console.log('\n=== 2. 순항 5000ft 250kt, 중립 유지 & 선회 ===');
{
  const ac = new Aircraft();
  const tr = ac.placeInAir(0, 5000 * FT, 0, 90, 250, 0, 0, false);
  console.log('trim', { alpha: (tr.alpha / DEG).toFixed(2), n1: tr.n1.toFixed(1), ths: (tr.delta / DEG).toFixed(2) });
  run(ac, 20, null, 5);
  check('수평 유지 (|VS| < 200 fpm)', Math.abs(ac.vs / FT * 60) < 200, (ac.vs / FT * 60).toFixed(0));
  check('고도 변화 < 100ft', Math.abs(ac.altFt - 5000) < 100, ac.altFt.toFixed(0));
  // 오른쪽 롤 2초 후 놓기
  run(ac, 2, (a) => { a.ctl.roll = 1; }, 0.5);
  run(ac, 15, (a) => { a.ctl.roll = 0; }, 3);
  check('경사 유지 18~35°', ac.bank > 18 && ac.bank < 36, ac.bank.toFixed(1));
  check('선회 중 고도 유지 ±100ft', Math.abs(ac.altFt - 5000) < 100, ac.altFt.toFixed(0));
  // 왼쪽 롤로 수평 복귀
  run(ac, 2, (a) => { a.ctl.roll = -1; }, 0.5);
  run(ac, 1, (a) => { a.ctl.roll = 0; }, 0);
  // 당김 2초 후 놓기 → 상승각 유지
  run(ac, 2, (a) => { a.ctl.pitch = 1; a.ctl.roll = 0; }, 0.5);
  run(ac, 8, (a) => { a.ctl.pitch = 0; }, 2);
  check('당김 후 상승 자세 유지 (VS > 500)', ac.vs / FT * 60 > 500, (ac.vs / FT * 60).toFixed(0));
}

/* 3. 최종 접근 → 착륙 */
console.log('\n=== 3. 최종접근 4NM, FULL, 3° → 플레어 → 착륙 ===');
{
  const ac = new Aircraft();
  const sp = ac.speeds();
  const dist = 4 * NM;
  const alt = Math.tan(3 * DEG) * dist + 15 + 2.9;      // 활주로 시단 50ft 통과 기준
  const tr = ac.placeInAir(0, alt, dist, 0, sp.vapp, -3, 4, true);
  console.log('Vapp', sp.vapp, 'trim', { alpha: (tr.alpha / DEG).toFixed(2), n1: tr.n1.toFixed(1), ths: (tr.delta / DEG).toFixed(2) });
  const lever0 = ac.ctl.lever;
  let flareStarted = false;
  run(ac, 200, (a) => {
    // 간단한 자동 속도 유지 (조종사 흉내)
    if (a.raFt > 40) a.ctl.lever = Math.max(0, Math.min(1, lever0 + (sp.vapp - a.ias) * 0.02));
    if (a.raFt < 35 && !a.wow) { a.ctl.lever = 0; a.ctl.pitch = 0.6; flareStarted = true; }
    if (a.wow) { a.ctl.pitch = 0; a.ctl.brake = a.wowTime > 2 ? 0.6 : 0; }
    if (a.wow && a.gs < 1) a.ctl.parking = true;
  }, 4);
  const td = ac.touchdown;
  console.log('touchdown', td && { fpm: td.fpm.toFixed(0), ias: td.ias.toFixed(0), pitch: td.pitch.toFixed(1), g: td.peakG.toFixed(2), z: td.pos.z.toFixed(0) });
  check('착지함', !!td);
  check('착지 강하율 < 350 fpm', td && td.fpm < 350, td && td.fpm.toFixed(0));
  check('착지 G < 1.7', td && td.peakG < 1.7, td && td.peakG.toFixed(2));
  check('착지 피치 0~8°', td && td.pitch > 0 && td.pitch < 8, td && td.pitch.toFixed(1));
  check('정지함', ac.gs < 1, ac.gs.toFixed(1));
  check('추락/꼬리 접촉 없음', !ac.crashed && !ac.tailStrike, ac.crashed || '');
}

/* 4. 지상 활주 조향 */
console.log('\n=== 4. 지상 활주 (틸러 조향) ===');
{
  const ac = new Aircraft();
  ac.placeOnGround(0, 0, 0);
  ac.ctl.parking = false; ac.ctl.lever = 0.12;
  run(ac, 25, (a) => { if (a.gs > 8) a.ctl.lever = 0.0; }, 5);
  const h0 = ac.heading;
  run(ac, 10, (a) => { a.ctl.roll = 0.8; a.ctl.lever = a.gs < 6 ? 0.1 : 0; }, 2);
  check('저속 선회 가능 (10초간 헤딩 변화 > 30°)', Math.abs(((ac.heading - h0 + 540) % 360) - 180) > 30, `${h0.toFixed(0)} → ${ac.heading.toFixed(0)}`);
  check('추락 없음', !ac.crashed, ac.crashed || '');
}

console.log(failures ? `\n❌ 실패 ${failures}건` : '\n✅ 모든 검증 통과');
process.exit(failures ? 1 : 0);
