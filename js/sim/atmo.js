// 국제표준대기(ISA)와 단위 상수
export const G = 9.80665;
export const RHO0 = 1.225;
export const KT = 0.514444;   // 1 knot = m/s
export const FT = 0.3048;     // 1 ft = m
export const NM = 1852;       // 1 해리 = m
export const DEG = Math.PI / 180;

export function isa(h) {
  const hh = Math.max(-500, h);
  let T, p;
  if (hh < 11000) {
    T = 288.15 - 0.0065 * hh;
    p = 101325 * Math.pow(T / 288.15, 5.25588);
  } else {
    T = 216.65;
    p = 22632.1 * Math.exp(-G * (hh - 11000) / (287.053 * T));
  }
  const rho = p / (287.053 * T);
  return { T, p, rho, a: Math.sqrt(1.4 * 287.053 * T), sigma: rho / RHO0 };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (cur, target, rate, dt) => {
  const d = target - cur, m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
};
export function wrap360(d) { d %= 360; return d < 0 ? d + 360 : d; }
export function wrap180(d) { d = wrap360(d); return d > 180 ? d - 360 : d; }
