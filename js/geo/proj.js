// 람베르트 정각원추도법(LCC) — 표준위선 33.5°N / 37.5°N, 중앙경선 127.5°E, 원점 35.8°N
// 월드 좌표: x = 동쪽(m), z = 남쪽(m)  (북쪽 = -z)
const R = 6371008.8;
const D = Math.PI / 180;
const PHI1 = 33.5 * D, PHI2 = 37.5 * D, PHI0 = 35.8 * D, LAM0 = 127.5 * D;
const t = (phi) => Math.tan(Math.PI / 4 + phi / 2);
const N = Math.log(Math.cos(PHI1) / Math.cos(PHI2)) / Math.log(t(PHI2) / t(PHI1));
const F = Math.cos(PHI1) * Math.pow(t(PHI1), N) / N;
const RHO0 = R * F / Math.pow(t(PHI0), N);

/** 위경도(도) → 월드 {x, z} */
export function toWorld(lat, lon) {
  const rho = R * F / Math.pow(t(lat * D), N);
  const th = N * (lon * D - LAM0);
  return { x: rho * Math.sin(th), z: -(RHO0 - rho * Math.cos(th)) };
}

/** 월드 → 위경도(도) */
export function toLatLon(x, z) {
  const y = -z;
  const rho = Math.sign(N) * Math.hypot(x, RHO0 - y);
  const th = Math.atan2(x, RHO0 - y);
  const lat = 2 * Math.atan(Math.pow(R * F / rho, 1 / N)) - Math.PI / 2;
  return { lat: lat / D, lon: (LAM0 + th / N) / D };
}

/** 자오선 수렴각(도). 진방위 = 격자방위(지도상 -z 기준) + convergence */
export function convergence(lon) { return N * (lon - 127.5); }

/** 대권 거리(m)와 진방위(도) */
export function greatCircle(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D, p2 = lat2 * D, dl = (lon2 - lon1) * D;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * R * Math.asin(Math.sqrt(a));
  const brg = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D;
  return { dist, brg: (brg + 360) % 360 };
}

// 자기 편차: 한반도 남부 약 8.5°W (2026년 근사). 자방위 = 진방위 + 8.5
export const MAG_VAR_W = 8.5;
export const trueToMag = (h) => ((h + MAG_VAR_W) % 360 + 360) % 360;
