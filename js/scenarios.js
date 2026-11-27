// 연습 시나리오 (연습 공항 33L 기준)
import { FT, NM, DEG } from './sim/atmo.js';

const TCH = 50 * FT;          // 시단 통과 높이
const CG_H = 2.9;             // 바퀴 → 무게중심 높이

export const WEIGHTS = {
  light:  { label: '가벼움 (약 56t)', payload: 7500, fuel: 6000 },
  normal: { label: '보통 (약 64t)',   payload: 13400, fuel: 8000 },
  heavy:  { label: '무거움 (약 72t)', payload: 18500, fuel: 11000 },
};

export const SCENARIOS = [
  {
    id: 'takeoff', title: '이륙 연습', badge: '기초',
    desc: '33L 활주로에 정렬, 플랩 1+F. 주기 브레이크(N) 해제 → 추력 TOGA(4) → VR에서 당겨 이륙.',
    setup(ac, rwy) {
      const e = rwy.ends[0];
      const p = e.thr.clone().addScaledVector(e.dir, 70);
      ac.placeOnGround(p.x, p.z, e.hdg);
    },
  },
  {
    id: 'final4', title: '착륙 연습 · 최종접근 4NM', badge: '추천',
    desc: '33L 4NM 앞, 1,300ft, 착륙 형태(FULL·기어 다운) 안정 접근 상태. PAPI와 활공경로 표시를 보며 착륙.',
    setup(ac, rwy, sp) {
      const e = rwy.ends[0], d = 4 * NM;
      const p = e.thr.clone().addScaledVector(e.dir, -d);
      ac.placeInAir(p.x, e.thr.y + Math.tan(3 * DEG) * d + TCH + CG_H, p.z, e.hdg, sp.vapp, -3, 4, true);
    },
  },
  {
    id: 'final12', title: '접근 연습 · 12NM 수평비행', badge: '중급',
    desc: '33L 12NM 앞, 3,000ft 수평, 200kt, 플랩 1. 감속·플랩·기어를 직접 설정하고 활공경로를 잡아 강하.',
    setup(ac, rwy) {
      const e = rwy.ends[0], d = 12 * NM;
      const p = e.thr.clone().addScaledVector(e.dir, -d);
      ac.placeInAir(p.x, e.thr.y + 3000 * FT + CG_H, p.z, e.hdg, 200, 0, 1, false);
    },
  },
  {
    id: 'circuit', title: '장주 비행 · 다운윈드', badge: '중급',
    desc: '활주로 왼쪽 2.5NM, 1,500ft, 반대 방향(150°)으로 비행 중. 왼쪽으로 돌아 33L에 착륙.',
    setup(ac, rwy) {
      const e = rwy.ends[0];
      const left = { x: e.dir.z, z: -e.dir.x };
      const p = rwy.center.clone(); p.x += left.x * 2.5 * NM; p.z += left.z * 2.5 * NM;
      ac.placeInAir(p.x, 1500 * FT + CG_H, p.z, (e.hdg + 180) % 360, 180, 0, 1, false);
    },
  },
  {
    id: 'free', title: '자유 비행 · 5,000ft', badge: '자유',
    desc: '공항 상공 5,000ft, 250kt, 클린 형태. 조작감 익히기와 선회 연습.',
    setup(ac, rwy) {
      const e = rwy.ends[0];
      ac.placeInAir(rwy.center.x, 5000 * FT + CG_H, rwy.center.z, e.hdg, 250, 0, 0, false);
    },
  },
];

/* ───────── 2단계: 대한민국 노선 ───────── */
export const ROUTE_STARTS = [
  { id: 'takeoff', title: '출발 활주로에서 이륙', desc: '출발 공항 활주로에 정렬된 상태에서 시작합니다.' },
  { id: 'cruise', title: '순항 중 (노선 중간)', desc: '출발·도착 공항의 중간 지점, 순항 고도에서 목적지 방향으로 비행 중.' },
  { id: 'app12', title: '도착 공항 접근 12NM', desc: '도착 활주로 12NM 앞, 3,000ft 수평, 200kt, 플랩 1.' },
  { id: 'final4', title: '도착 공항 최종접근 4NM', desc: '도착 활주로 4NM 앞, 착륙 형태로 안정 접근 중.' },
];

/** 활주로 끝 찾기: world.runways 중 이름이 같은 끝 */
export function findRunwayEnd(world, icao, name) {
  for (const r of world.runways) {
    if (r.airport.icao !== icao) continue;
    for (const e of r.ends) if (e.name === name) return { rwy: r, end: e };
  }
  return null;
}

export function setupRoute(ac, world, cfg, sp) {
  if (cfg.start === 'takeoff') {
    const { end } = findRunwayEnd(world, cfg.dep, cfg.depRwy);
    const p = end.thr.clone().addScaledVector(end.dir, 70);
    ac.placeOnGround(p.x, p.z, end.hdg);
    // 공항 표고 반영
    ac.pos.y = end.thr.y + 3.3 - 0.40;
    ac.updateDerived();
    return;
  }
  if (cfg.start === 'cruise') {
    const a = world.airports.find(x => x.icao === cfg.dep), b = world.airports.find(x => x.icao === cfg.dest);
    const mx = (a.geo.pos.x + b.geo.pos.x) / 2, mz = (a.geo.pos.z + b.geo.pos.z) / 2;
    const dist = Math.hypot(b.geo.pos.x - a.geo.pos.x, b.geo.pos.z - a.geo.pos.z);
    const fl = dist > 300000 ? 28000 : 20000;
    const hdg = (Math.atan2(b.geo.pos.x - mx, -(b.geo.pos.z - mz)) * 180 / Math.PI + 360) % 360;
    ac.placeInAir(mx, fl * FT, mz, hdg, fl > 25000 ? 280 : 290, 0, 0, false);
    return;
  }
  const { end } = findRunwayEnd(world, cfg.dest, cfg.destRwy);
  const d = (cfg.start === 'app12' ? 12 : 4) * NM;
  const p = end.thr.clone().addScaledVector(end.dir, -d);
  if (cfg.start === 'app12') {
    let alt = end.thr.y + 3000 * FT;
    const gnd = world.groundAt(p.x, p.z);
    alt = Math.max(alt, gnd + 1500 * FT);
    ac.placeInAir(p.x, alt + CG_H, p.z, end.hdg, 200, 0, 1, false);
  } else {
    ac.placeInAir(p.x, end.thr.y + Math.tan(3 * DEG) * d + TCH + CG_H, p.z, end.hdg, sp.vapp, -3, 4, true);
  }
}
