// KF-320 : A320급 협동체 쌍발 여객기 (가상 기체, 공개 자료 수준의 성능을 참고)
import { DEG } from './atmo.js';

export const AC = {
  name: 'KF-320',
  desc: 'A320급 협동체 쌍발 여객기 (가상 기체)',

  // 기하
  S: 122.6,      // 날개 면적 m²
  b: 34.1,       // 날개폭 m
  c: 4.19,       // 평균공력시위 m

  // 무게 (kg)
  oew: 42600, maxFuel: 18700, mtow: 78000, mlw: 66000,

  // 관성모멘트 (기준 질량 64t)
  inertiaRef: { mass: 64000, pitch: 3.6e6, yaw: 5.0e6, roll: 1.6e6 },

  // 양력·항력
  CLa: 5.0,          // 양력 기울기 /rad
  CD0: 0.022,        // 형상항력 (클린)
  k: 0.042,          // 유도항력 계수
  gearCD: 0.025,
  // 플랩 레버 위치별 (0,1,2,3,FULL)
  configs: [
    { name: '0',    CL0: 0.20, aStall: 14.5, dCD: 0.000, dCm: 0.00,  vfe: 350 },
    { name: '1',    CL0: 0.42, aStall: 17.5, dCD: 0.012, dCm: -0.01, vfe: 230 },
    { name: '2',    CL0: 0.72, aStall: 17.0, dCD: 0.028, dCm: -0.03, vfe: 200 },
    { name: '3',    CL0: 0.88, aStall: 16.5, dCD: 0.038, dCm: -0.04, vfe: 185 },
    { name: 'FULL', CL0: 1.20, aStall: 16.0, dCD: 0.058, dCm: -0.06, vfe: 177 },
  ],
  conf1F: { name: '1+F', CL0: 0.55, aStall: 17.0, dCD: 0.030, dCm: -0.02, vfe: 215 },

  vmo: 350, mmo: 0.82, vle: 280,

  // 세로(피치) 안정·조종 미계수
  Cm0: 0.10, Cma: -2.0, Cmq: -22, Cmde: 1.6,
  // 가로·방향
  Clb: -0.10, Clp: -0.45, Clr: 0.12, Clda: 0.055, Cldr: 0.006,
  Cnb: 0.12,  Cnr: -0.18, Cnp: -0.03, Cndr: 0.065, Cnda: -0.004,
  CYb: -0.9,  CYdr: 0.18,

  // 조종면 한계
  elevUp: 30 * DEG, elevDn: 17 * DEG,
  thsMin: -4 * DEG, thsMax: 13.5 * DEG,
  takeoffThs: 2.0 * DEG,

  // 엔진 (CFM56급 × 2)
  nEng: 2,
  thrustStatic: 120000,   // N / 엔진
  thrustY: -1.6,          // 추력선 (무게중심 아래 m)
  n1IdleGround: 21, n1IdleFlight: 27, n1Toga: 97,
  // 추력 레버 위치(0~1) → N1 (%)
  leverTable: [[0, null], [0.5, 89], [0.78, 93.5], [1.0, 97]],
  detents: { IDLE: 0, CL: 0.5, MCT: 0.78, TOGA: 1.0 },
  revN1Max: 72, revEff: 0.38,

  // 랜딩기어 접지점 (기체 좌표: x 오른쪽, y 위, z 뒤 / m)
  gear: [
    { name: 'nose',  p: [0, -3.3, -11.1], k: 1.9e5,  c: 5.0e4, steer: true },
    { name: 'left',  p: [-3.8, -3.3, 1.5], k: 6.9e5, c: 2.2e5, brake: true },
    { name: 'right', p: [3.8, -3.3, 1.5],  k: 6.9e5, c: 2.2e5, brake: true },
  ],
  gearStatic: 0.40,   // 정지 시 주기어 압축량 m
  // 기체가 땅에 닿으면 안 되는 점들
  strikePoints: [
    { name: 'tail',   p: [0, -0.2, 16],     kind: 'tail' },
    { name: 'engL',   p: [-5.75, -2.6, -2], kind: 'engine' },
    { name: 'engR',   p: [5.75, -2.6, -2],  kind: 'engine' },
    { name: 'tipL',   p: [-17, -0.2, 4],    kind: 'wing' },
    { name: 'tipR',   p: [17, -0.2, 4],     kind: 'wing' },
    { name: 'bellyF', p: [0, -2.1, -9],     kind: 'belly' },
    { name: 'bellyA', p: [0, -2.1, 6],      kind: 'belly' },
  ],
  cockpitEye: [-0.55, 1.55, -14.6],
};

// 플랩 위치(연속값 0~4)에 따른 공력 파라미터 보간
export function flapParams(pos, is1F) {
  const cfg = AC.configs.map((c, i) => (i === 1 && is1F ? AC.conf1F : c));
  const i = Math.min(3, Math.floor(pos)), t = pos - i;
  const a = cfg[i], b = cfg[i + 1];
  const L = (k) => a[k] + (b[k] - a[k]) * t;
  return { CL0: L('CL0'), aStall: L('aStall') * DEG, dCD: L('dCD'), dCm: L('dCm') };
}

export function flapLabel(lever, is1F) {
  return lever === 1 && is1F ? '1+F' : AC.configs[lever].name;
}

export function vfeOf(lever, is1F) {
  return lever === 1 && is1F ? AC.conf1F.vfe : AC.configs[lever].vfe;
}

// 레버 → N1
export function leverToN1(L, idle) {
  const t = AC.leverTable;
  const tab = t.map(([x, y]) => [x, y === null ? idle : y]);
  for (let i = 1; i < tab.length; i++) {
    if (L <= tab[i][0]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return y0 + (y1 - y0) * (L - x0) / (x1 - x0);
    }
  }
  return tab[tab.length - 1][1];
}
export function n1ToLever(n1, idle) {
  const tab = AC.leverTable.map(([x, y]) => [x, y === null ? idle : y]);
  if (n1 <= idle) return 0;
  for (let i = 1; i < tab.length; i++) {
    if (n1 <= tab[i][1]) {
      const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
      return x0 + (x1 - x0) * (n1 - y0) / (y1 - y0);
    }
  }
  return 1;
}
// N1 → 정지 추력 대비 비율
export function n1ToThrustFrac(n1) {
  const x = Math.max(0, (n1 - AC.n1IdleGround) / (AC.n1Toga - AC.n1IdleGround));
  return 0.03 + 0.97 * Math.pow(x, 1.7);
}
export function thrustFracToN1(f) {
  const x = Math.pow(Math.max(0, (f - 0.03) / 0.97), 1 / 1.7);
  return AC.n1IdleGround + x * (AC.n1Toga - AC.n1IdleGround);
}
export function thrustLapse(mach, sigma) {
  return (1 - 0.85 * mach + 0.45 * mach * mach) * Math.pow(sigma, 0.75);
}

// FLEX(가정 온도) 감추력: 가정 온도가 높을수록 N1 감소 (ISA 15°C 기준, 최대 25% 감추력 수준)
export function flexN1(temp) {
  const t = Math.max(15, Math.min(70, temp));
  return 93.5 - (t - 15) * 0.13;
}
