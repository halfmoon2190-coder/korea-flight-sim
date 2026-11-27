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
