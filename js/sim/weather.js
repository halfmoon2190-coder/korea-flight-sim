// 날씨: 바람(고도별) · 돌풍 · 난기류 · 시정 · 구름
import { Vector3 } from '../../vendor/three.module.min.js';
import { KT, FT, DEG } from './atmo.js';

export const WX_PRESETS = {
  calm:  { label: '맑음 · 무풍', dir: 0, spd: 0, gust: 0, turb: 0, vis: 40000, base: null, cover: 0 },
  light: { label: '맑음 · 약한 바람 (8kt)', dir: 270, spd: 8, gust: 0, turb: 0.15, vis: 35000, base: 5000, cover: 0.3 },
  cross: { label: '측풍 연습 (도착 활주로 오른쪽 90°, 15kt)', rel: 90, spd: 15, gust: 5, turb: 0.3, vis: 25000, base: 4000, cover: 0.4 },
  windy: { label: '강풍 · 난기류 (25kt, 돌풍 37kt)', dir: 300, spd: 25, gust: 12, turb: 0.8, vis: 20000, base: 2500, cover: 0.6 },
  low:   { label: '낮은 구름 (구름 밑 800ft, 시정 6km)', dir: 200, spd: 10, gust: 4, turb: 0.35, vis: 6000, base: 800, cover: 0.95 },
  fog:   { label: '짙은 안개 (시정 500m) — 자동착륙 연습', dir: 0, spd: 3, gust: 0, turb: 0, vis: 500, base: 150, cover: 1.0 },
};

// 간단한 1차 저역통과 잡음
class Noise {
  constructor(tau, seed) { this.tau = tau; this.v = 0; this.s = seed; }
  rnd() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647 * 2 - 1; }
  step(dt) { const a = Math.min(1, dt / this.tau); this.v += (this.rnd() * 1.7 - this.v) * a; return this.v; }
}

export class Weather {
  constructor() {
    this.set(WX_PRESETS.calm);
    this.n = [new Noise(1.2, 11), new Noise(0.9, 23), new Noise(1.6, 37), new Noise(4.0, 51)];
    this.turbVec = new Vector3();
    this.gustNow = 0;
  }
  /** p: 프리셋 또는 사용자 설정. dir = 바람이 불어오는 방향(자북 기준, 도) */
  set(p) {
    this.p = { ...p };
    this.dir = p.dir ?? 0; this.spd = p.spd ?? 0; this.gust = p.gust ?? 0; this.turb = p.turb ?? 0;
    this.vis = p.vis ?? 40000; this.base = p.base ?? null; this.cover = p.cover ?? 0;
    this.top = this.base !== null ? this.base + (this.cover > 0.8 ? 3000 : 1500) : null;
  }
  /** 활주로 기준 상대 바람(rel)을 실제 방향으로 확정 */
  resolve(rwyMagHdg) { if (this.p.rel !== undefined) this.dir = (rwyMagHdg + this.p.rel + 360) % 360; }

  /** 바람 벡터 (월드, m/s, 공기가 움직이는 방향). hdgOffset: 격자→자북 보정, agl: 지면 높이(m), mslFt */
  sample(dt, mslFt, agl, hdgOffset) {
    const h = Math.max(0, mslFt * FT);
    let spd = this.spd * (1 + Math.min(1.5, h / 4000));          // 고도가 높을수록 강해짐
    if (agl < 10) spd *= Math.max(0.55, Math.log(Math.max(agl, 0.1) / 0.05) / Math.log(10 / 0.05));
    const dir = this.dir + Math.min(1, h / 4000) * 25;           // 고도에 따라 시계방향으로 변함
    // 돌풍: 바람 방향 성분으로 0~gust
    const g = Math.max(0, this.n[3].step(dt)) * this.gust;
    this.gustNow = g;
    const sp = (spd + g) * KT;
    const gridFrom = (dir - hdgOffset) * DEG;
    const w = new Vector3(-Math.sin(gridFrom) * sp, 0, Math.cos(gridFrom) * sp);   // 불어오는 반대쪽으로 이동
    // 난기류 (저고도 · 구름 속에서 강하게)
    if (this.turb > 0) {
      let k = this.turb * (1.5 + this.spd * 0.12);
      if (agl < 900) k *= 1.3;
      if (this.base !== null && mslFt > this.base && mslFt < this.top) k *= 1.4;
      if (mslFt > 20000) k *= 0.5;
      this.turbVec.set(this.n[0].step(dt) * k, this.n[1].step(dt) * k * 0.6, this.n[2].step(dt) * k);
      w.add(this.turbVec);
    }
    return w;
  }
  /** 구름 속 여부 */
  inCloud(mslFt) { return this.base !== null && this.cover > 0.6 && mslFt > this.base && mslFt < this.top; }
  /** ATIS 형식 문자열 */
  atis() { return this.spd < 1 ? '바람 고요(CALM)' : `바람 ${String(Math.round(this.dir / 10) * 10 || 360).padStart(3, '0')}° ${Math.round(this.spd)}kt${this.gust ? ` 돌풍 ${Math.round(this.spd + this.gust)}kt` : ''}`; }
  /** 활주로 자방위 기준 정풍/측풍 성분 (kt, 정풍 +, 오른쪽에서 +) */
  components(rwyMagHdg) {
    const a = (this.dir - rwyMagHdg) * DEG;
    return { head: this.spd * Math.cos(a), cross: this.spd * Math.sin(a) };
  }
}
