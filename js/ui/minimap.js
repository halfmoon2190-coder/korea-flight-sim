// 지도 (M 키): 전체 한반도 / 주변 60NM
import { AIRPORTS } from '../geo/airports.js';
import { toLatLon, convergence } from '../geo/proj.js';

export class Minimap {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.mode = 0;            // 0 끔, 1 전체, 2 주변
    this.img = null;
    this.t = 0;
    this.h = 0;
  }

  setTerrain(korea) {
    const b = korea.terrain.base;
    this.b = b;
    const aspect = (b.lon1 - b.lon0) * Math.cos(35.8 * Math.PI / 180) / (b.lat1 - b.lat0);
    const W = 520, H = Math.round(W / aspect);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const im = x.createImageData(W, H);
    const hAt = (i, j) => {
      const gi = Math.min(b.w - 1, Math.max(0, Math.round(i / W * (b.w - 1))));
      const gj = Math.min(b.h - 1, Math.max(0, Math.round(j / H * (b.h - 1))));
      return b.data[gj * b.w + gi];
    };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const h = hAt(i, j), hx = hAt(i + 1, j) - h, hy = hAt(i, j + 1) - h;
      const sh = Math.max(0.55, Math.min(1.35, 1 - (hx - hy) * 0.004));
      let c3;
      if (h <= 0.5) { const d = Math.min(1, -h / 120); c3 = [34 - d * 14, 78 - d * 30, 118 - d * 25]; }
      else if (h < 60) c3 = [112 * sh, 146 * sh, 86 * sh];
      else if (h < 500) c3 = [74 * sh, 118 * sh, 64 * sh];
      else c3 = [128 * sh, 122 * sh, 100 * sh];
      const k = (j * W + i) * 4;
      im.data[k] = c3[0]; im.data[k + 1] = c3[1]; im.data[k + 2] = c3[2]; im.data[k + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    this.img = c; this.W = W; this.H = H;
  }

  px(lat, lon) { return [(lon - this.b.lon0) / (this.b.lon1 - this.b.lon0) * this.W, (this.b.lat1 - lat) / (this.b.lat1 - this.b.lat0) * this.H]; }

  draw(ac, world, route) {
    const show = this.mode > 0 && this.img && world.kind === 'korea';
    this.cv.hidden = !show;
    if (!show) { this.h = 0; return; }
    const now = performance.now();
    if (now - this.t < 200) return;
    this.t = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cw, ch;
    if (this.mode === 1) { ch = Math.min(window.innerHeight * 0.5, 440); cw = ch * this.W / this.H; }
    else { cw = ch = Math.min(window.innerHeight * 0.42, 300); }
    this.h = ch;
    if (this.cv.width !== Math.round(cw * dpr)) { this.cv.width = Math.round(cw * dpr); this.cv.height = Math.round(ch * dpr); this.cv.style.width = cw + 'px'; this.cv.style.height = ch + 'px'; }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const ll = toLatLon(ac.pos.x, ac.pos.z);
    // 화면 변환: 지도 픽셀 → 캔버스
    let sx, sy, s;
    if (this.mode === 1) { s = cw / this.W; sx = 0; sy = 0; }
    else {
      const [ax, ay] = this.px(ll.lat, ll.lon);
      const spanPx = 120 / 60 / (this.b.lat1 - this.b.lat0) * this.H;   // 120NM(위도 2°)
      s = ch / spanPx; sx = ax - spanPx / 2; sy = ay - spanPx / 2;
    }
    const T = (lat, lon) => { const [x, y] = this.px(lat, lon); return [(x - sx) * s, (y - sy) * s]; };
    g.imageSmoothingEnabled = true;
    g.drawImage(this.img, sx, sy, cw / s, ch / s, 0, 0, cw, ch);

    // 노선
    if (route) {
      const a = AIRPORTS.find(x => x.icao === route.dep), b = AIRPORTS.find(x => x.icao === route.dest);
      g.strokeStyle = '#ff4fe0'; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(...T(a.lat, a.lon)); g.lineTo(...T(b.lat, b.lon)); g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.moveTo(...T(ll.lat, ll.lon)); g.lineTo(...T(b.lat, b.lon)); g.strokeStyle = 'rgba(255,79,224,0.45)'; g.stroke();
    }
    // 공항 · 활주로
    g.font = 'bold 12px sans-serif'; g.textBaseline = 'middle';
    for (const ap of AIRPORTS) {
      const [x, y] = T(ap.lat, ap.lon);
      if (this.mode === 2) {
        g.strokeStyle = '#fff'; g.lineWidth = 3;
        for (const r of ap.runways) { g.beginPath(); g.moveTo(...T(...r.a)); g.lineTo(...T(...r.b)); g.stroke(); }
      } else {
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3;
      const label = `${ap.short} ${ap.icao}`;
      g.strokeText(label, x + 7, y - 8); g.fillText(label, x + 7, y - 8);
    }
    // 항공기 (진방위로 회전)
    const [px, py] = T(ll.lat, ll.lon);
    const trueHdg = ac.heading + convergence(ll.lon);
    g.save(); g.translate(px, py); g.rotate(trueHdg * Math.PI / 180);
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // 축척 표시
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(6, ch - 22, 120, 16);
    g.fillStyle = '#fff'; g.font = '11px sans-serif';
    g.fillText(this.mode === 1 ? 'M: 주변 지도로' : '주변 ±60NM · M: 끄기', 10, ch - 14);
  }
}
