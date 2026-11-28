// 성능 계산: 운항 연료 · 비행 시간 · 이륙/착륙 거리 (비행 물리 시뮬레이션 기반)
import { Aircraft } from './aircraft.js';
import { AC } from './a320.js';
import { KT, FT, NM, DEG } from './atmo.js';

/* ── 운항 연료 (58t 기준, 비행 물리로 측정한 값의 보간) ── */
const FUEL_TABLE = [[0, 250], [60, 676], [120, 1098], [180, 1465], [240, 1812], [400, 2700], [800, 4900]];
const TIME_TABLE = [[0, 6], [60, 17], [120, 26.9], [180, 35.4], [240, 43.3], [400, 66], [800, 122]];
function interp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return tab[tab.length - 1][1];
}
/** 운항 연료(kg): 경로 거리(NM), 이륙 중량(kg) */
export function tripFuel(distNm, tow) {
  return Math.round(interp(FUEL_TABLE, distNm) * (1 + (tow - 58000) * 1.08e-5) / 10) * 10;
}
export function tripTime(distNm) { return interp(TIME_TABLE, distNm); }
/** 30분 체공 연료 (1,500ft 체공, 중량 비례) */
export function finalReserve(lw) { return Math.round((1050 * lw / 60000) / 10) * 10; }

export const PAX_KG = 84;         // 승객 1인 + 수하물 표준 중량
export const MAX_PAX = 180;
export const LIMITS = { mzfw: 62500, mtow: AC.mtow, mlw: AC.mlw, maxFuel: AC.maxFuel };

/* ── 이륙 성능: 평지 활주로에서 실제 물리로 시뮬레이션 ── */
export function takeoffPerf({ mass, toFlap = 1, flexTemp = null, elev = 0 }) {
  const ac = new Aircraft(() => elev);
  ac.payload = mass - AC.oew - 6000; ac.fuelInit = 6000;
  ac.toFlap = toFlap; ac.flexTemp = flexTemp;
  ac.placeOnGround(0, 0, 0);
  if (toFlap === 2) { ac.ctl.flapLever = 2; ac.flapPos = 2; ac.is1F = false; }
  ac.ctl.parking = false;
  const sp = ac.speeds(mass, toFlap);
  ac.ctl.lever = flexTemp ? AC.detents.MCT : 1;
  const DT = 1 / 60;
  let vrDist = null, loDist = null, d35 = null;
  const z0 = ac.pos.z;
  for (let i = 0; i < 60 * 90; i++) {
    const dist = z0 - ac.pos.z;
    if (vrDist === null && ac.ias >= sp.vr) vrDist = dist;
    if (vrDist !== null) ac.ctl.pitch = ac.pitch < 15 ? 0.55 : 0;
    ac.step(DT);
    if (!ac.wow && loDist === null && ac.airTime > 0.2) loDist = dist;
    if (ac.raFt >= 35) { d35 = dist; break; }
    if (ac.crashed || ac.tailStrike) break;
  }
  // 필요 이륙거리: 엔진 1개 고장·이륙 중단 여유를 반영한 근사 (전 엔진 35ft 거리 × 1.4)
  return { ...sp, vrDist, loDist, d35, required: d35 ? Math.round(d35 * 1.4) : null, tail: ac.tailStrike };
}

/** 활주로 길이(TORA)에 맞는 최대 FLEX 온도 (없으면 null = TOGA 필요) */
export function maxFlex({ mass, toFlap, tora, elev }) {
  let best = null;
  for (let t = 30; t <= 68; t += 4) {
    const r = takeoffPerf({ mass, toFlap, flexTemp: t, elev });
    if (r.required && r.required <= tora && !r.tail) best = t; else break;
  }
  return best;
}

/** 착륙 거리(m): 50ft 통과~정지. autobrake 1(LO)/2(MED)/0(수동 최대) */
export function landingDistance({ lw, autobrake = 1, vapp }) {
  const vtd = (vapp - 4) * KT;
  const air = 330;                                // 50ft → 접지
  const a = autobrake === 1 ? 1.7 : autobrake === 2 ? 3.0 : 3.4;
  const free = vtd * 2.0;                         // 접지 후 스포일러 · 제동 지연
  const roll = vtd * vtd / (2 * a);
  const d = air + free + roll;
  return { actual: Math.round(d), required: Math.round(d * 1.15) };
}
