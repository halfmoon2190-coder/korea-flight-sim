// 한반도 지형: 높이맵 로딩 · 샘플링 · 공항 평탄화 · LOD 청크 메쉬 · 색상
import * as THREE from '../../vendor/three.module.min.js';
import { toWorld, toLatLon } from '../geo/proj.js';

/* ───────── 높이맵 로딩 ───────── */
export async function loadHeightmaps(baseUrl, onProgress) {
  const meta = await (await fetch(baseUrl + 'meta.json')).json();
  const grids = [];
  let done = 0;
  for (const g of meta.grids) {
    const blob = await (await fetch(baseUrl + g.file)).blob();
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    const data = new Float32Array(bmp.width * bmp.height);
    for (let i = 0; i < data.length; i++) data[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / meta.scale - meta.offset;
    grids.push({ ...g, data });
    onProgress?.(++done / meta.grids.length);
  }
  return { meta, grids };
}

/* ───────── 지형 모델 (샘플링 + 공항 평탄화) ───────── */
export class Terrain {
  constructor(hm, airports) {
    this.base = hm.grids.find(g => g.name === 'base');
    this.details = hm.grids.filter(g => g.name !== 'base');
    this.pads = [];
    this.airportZones = [];
    for (const ap of airports) this.addAirport(ap);
    // 월드 경계 (기본 격자의 네 모서리)
    const c = [toWorld(this.base.lat0, this.base.lon0), toWorld(this.base.lat0, this.base.lon1), toWorld(this.base.lat1, this.base.lon0), toWorld(this.base.lat1, this.base.lon1)];
    this.bounds = { x0: Math.min(...c.map(p => p.x)), x1: Math.max(...c.map(p => p.x)), z0: Math.min(...c.map(p => p.z)), z1: Math.max(...c.map(p => p.z)) };
  }

  addAirport(ap) {
    const elev = ap.elevFt * 0.3048;
    const zone = { x: 0, z: 0, r: 0, elev, pads: [] };
    const pts = [];
    for (const r of ap.geo.runways) {
      const hw = r.W / 2 + Math.max(150, r.twy ? r.twy.off + 60 : 0);
      zone.pads.push({ cx: r.center.x, cz: r.center.z, dx: r.dir.x, dz: r.dir.z, hl: r.L / 2 + 380, hw, elev, blend: 700 });
      pts.push(r.center);
    }
    for (const t of ap.geo.terminals) {
      zone.pads.push({ cx: t.center.x, cz: t.center.z, dx: t.dir.x, dz: t.dir.z, hl: t.len / 2 + 250, hw: (t.wid + t.apron) / 2 + 250, elev, blend: 700 });
      pts.push(t.center);
    }
    zone.x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    zone.z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    zone.r = Math.max(...zone.pads.map(p => Math.hypot(p.cx - zone.x, p.cz - zone.z) + Math.hypot(p.hl, p.hw) + p.blend)) + 100;
    this.airportZones.push(zone);
  }

  sampleGrid(g, lat, lon) {
    const fx = Math.min(g.w - 1.001, Math.max(0, (lon - g.lon0) / g.step));
    const fy = Math.min(g.h - 1.001, Math.max(0, (g.lat1 - lat) / g.step));
    const ix = fx | 0, iy = fy | 0, dx = fx - ix, dy = fy - iy;
    const d = g.data, w = g.w, k = iy * w + ix;
    return d[k] * (1 - dx) * (1 - dy) + d[k + 1] * dx * (1 - dy) + d[k + w] * (1 - dx) * dy + d[k + w + 1] * dx * dy;
  }

  /** 원 지형 고도 (평탄화 전) */
  rawHeight(x, z) {
    const { lat, lon } = toLatLon(x, z);
    const b = this.base;
    if (lat < b.lat0 || lat > b.lat1 || lon < b.lon0 || lon > b.lon1) return -200;
    let h = this.sampleGrid(b, lat, lon);
    for (const g of this.details) {
      if (lat <= g.lat0 || lat >= g.lat1 || lon <= g.lon0 || lon >= g.lon1) continue;
      const edge = Math.min(lat - g.lat0, g.lat1 - lat, lon - g.lon0, g.lon1 - lon);
      const w = Math.min(1, edge / 0.04);
      h += (this.sampleGrid(g, lat, lon) - h) * w * w * (3 - 2 * w);
      break;
    }
    return h;
  }

  /** 공항 평탄화 가중치 (0~1)와 표고 */
  airportWeight(x, z) {
    for (const zn of this.airportZones) {
      if (Math.abs(x - zn.x) > zn.r || Math.abs(z - zn.z) > zn.r) continue;
      let wmax = 0;
      for (const p of zn.pads) {
        const rx = x - p.cx, rz = z - p.cz;
        const u = rx * p.dx + rz * p.dz, v = -rx * p.dz + rz * p.dx;
        const ou = Math.max(0, Math.abs(u) - p.hl), ov = Math.max(0, Math.abs(v) - p.hw);
        const d = Math.hypot(ou, ov);
        if (d === 0) { wmax = 1; break; }
        if (d < p.blend) { const t = 1 - d / p.blend; wmax = Math.max(wmax, t * t * (3 - 2 * t)); }
      }
      if (wmax > 0) return { w: wmax, elev: zn.elev };
    }
    return null;
  }

  /** 최종 지면 고도 (물은 0 이하 그대로 반환) */
  height(x, z) {
    let h = this.rawHeight(x, z);
    const a = this.airportWeight(x, z);
    if (a) h += (a.elev - h) * a.w;
    return h;
  }
  /** 비행 물리용: 수면은 0 */
  groundAt(x, z) { return Math.max(0, this.height(x, z)); }
  isWater(x, z) { return this.height(x, z) <= 0.2; }
}

/* ───────── 색상 ───────── */
const CITIES = [
  ['서울', 37.5665, 126.978, 13], ['인천', 37.456, 126.705, 8], ['수원', 37.263, 127.028, 6], ['성남', 37.42, 127.13, 5],
  ['고양', 37.658, 126.832, 5], ['부천', 37.503, 126.766, 4], ['안산', 37.32, 126.83, 4], ['부산', 35.16, 129.06, 10],
  ['대구', 35.87, 128.6, 9], ['대전', 36.35, 127.385, 8], ['광주', 35.16, 126.85, 7], ['울산', 35.54, 129.31, 7],
  ['창원', 35.23, 128.68, 6], ['김해', 35.235, 128.88, 4], ['전주', 35.82, 127.15, 5], ['청주', 36.64, 127.49, 5],
  ['포항', 36.02, 129.34, 4], ['천안', 36.81, 127.15, 4], ['제주', 33.50, 126.53, 4], ['서귀포', 33.25, 126.56, 2.5],
  ['여수', 34.76, 127.66, 3], ['목포', 34.81, 126.39, 3], ['군산', 35.97, 126.71, 3], ['강릉', 37.75, 128.9, 3],
  ['원주', 37.34, 127.92, 3], ['춘천', 37.88, 127.73, 3], ['구미', 36.12, 128.34, 3], ['진주', 35.18, 128.11, 3],
  ['순천', 34.95, 127.49, 3], ['경주', 35.84, 129.21, 2.5], ['평택', 36.99, 127.09, 3], ['양산', 35.34, 129.03, 3],
].map(([name, lat, lon, rkm]) => ({ name, ...toWorld(lat, lon), r: rkm * 1000 }));
export { CITIES };

function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const C = {
  deep: [0.10, 0.27, 0.42], shallow: [0.20, 0.42, 0.55], sand: [0.62, 0.60, 0.48],
  paddy: [0.52, 0.60, 0.33], field: [0.60, 0.58, 0.38], grassA: [0.42, 0.55, 0.28],
  forest: [0.22, 0.36, 0.18], forest2: [0.17, 0.29, 0.15], rock: [0.45, 0.43, 0.38], high: [0.50, 0.48, 0.42],
  city: [0.55, 0.55, 0.53], airport: [0.46, 0.56, 0.30],
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function terrainColor(h, slope, x, z, aw, out) {
  let c;
  if (h <= 0.2 && !(aw > 0.5)) {
    c = mix(C.shallow, C.deep, Math.min(1, -h / 60));
  } else {
    const n1 = vnoise(x / 2200, z / 2200), n2 = vnoise(x / 600 + 50, z / 600);
    if (h < 3) c = mix(C.sand, C.paddy, h / 3);
    else if (h < 90) c = mix(mix(C.paddy, C.field, n2), C.grassA, Math.min(1, n1 * 0.8 + slope * 2));
    else if (h < 700) c = mix(C.forest, C.forest2, n1);
    else c = mix(C.forest2, C.high, Math.min(1, (h - 700) / 900));
    // 낮은 지대의 산림: 경사가 있으면 숲
    if (h >= 3 && h < 90 && slope > 0.12) c = mix(c, C.forest, Math.min(1, (slope - 0.12) * 5));
    if (slope > 0.75) c = mix(c, C.rock, Math.min(1, (slope - 0.75) * 2));
    // 도시
    if (h < 200) {
      for (const ct of CITIES) {
        const dx = x - ct.x, dz = z - ct.z;
        if (Math.abs(dx) > ct.r * 1.3 || Math.abs(dz) > ct.r * 1.3) continue;
        const d = Math.hypot(dx, dz) / ct.r;
        const t = Math.max(0, Math.min(1, (1.15 - d) * 2.5 - n2 * 0.6)) * (slope < 0.25 ? 1 : 0.3);
        if (t > 0) c = mix(c, C.city, t * 0.85);
      }
    }
    if (aw > 0) c = mix(c, C.airport, Math.min(1, aw * 1.6));
    const shade = 0.9 + n2 * 0.2;
    c = [c[0] * shade, c[1] * shade, c[2] * shade];
  }
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
}

/* ───────── LOD 청크 관리 ───────── */
const CHUNK = 16000;   // 청크 크기 m

export class TerrainRenderer {
  constructor(terrain, quality) {
    this.t = terrain;
    this.group = new THREE.Group();
    this.quality = quality;
    this.chunks = new Map();
    this.queue = [];
    this.indexCache = new Map();
    const tex = detailTexture();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
    this.radius = quality === 'low' ? 55000 : quality === 'medium' ? 75000 : 95000;
  }

  lodFor(dist, overDetail) {
    const q = this.quality === 'low' ? 0.6 : this.quality === 'high' ? 1.3 : 1;
    if (dist < 7000 * q && overDetail) return 256;
    if (dist < 14000 * q) return 128;
    if (dist < 30000 * q) return 64;
    if (dist < 55000 * q) return 32;
    return 16;
  }

  overDetail(cx, cz) {
    const { lat, lon } = toLatLon(cx, cz);
    return this.t.details.some(g => lat > g.lat0 - 0.15 && lat < g.lat1 + 0.15 && lon > g.lon0 - 0.15 && lon < g.lon1 + 0.15);
  }

  update(camPos, budgetMs = 6) {
    const r = this.radius + Math.min(40000, Math.max(0, camPos.y) * 3);
    const b = this.t.bounds;
    const i0 = Math.floor(Math.max(b.x0, camPos.x - r) / CHUNK), i1 = Math.floor(Math.min(b.x1, camPos.x + r) / CHUNK);
    const j0 = Math.floor(Math.max(b.z0, camPos.z - r) / CHUNK), j1 = Math.floor(Math.min(b.z1, camPos.z + r) / CHUNK);
    const want = new Set();
    const jobs = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx = (i + 0.5) * CHUNK, cz = (j + 0.5) * CHUNK;
      const dx = Math.max(0, Math.abs(camPos.x - cx) - CHUNK / 2), dz = Math.max(0, Math.abs(camPos.z - cz) - CHUNK / 2);
      const dist = Math.hypot(dx, dz, Math.max(0, camPos.y - 500) * 0.5);
      if (Math.hypot(dx, dz) > r) continue;
      const key = i + ',' + j;
      want.add(key);
      const ch = this.chunks.get(key);
      const lod = this.lodFor(dist, ch ? ch.overDetail : this.overDetail(cx, cz));
      if (!ch || ch.lod !== lod) jobs.push({ key, i, j, lod, dist, ch });
    }
    for (const [key, ch] of this.chunks) {
      if (!want.has(key)) { this.group.remove(ch.mesh); ch.mesh.geometry.dispose(); this.chunks.delete(key); }
    }
    jobs.sort((a, b) => (a.ch ? 1 : 0) - (b.ch ? 1 : 0) || a.dist - b.dist);
    const t0 = performance.now();
    let built = 0;
    for (const jb of jobs) {
      if (built > 0 && performance.now() - t0 > budgetMs) break;
      this.buildChunk(jb);
      built++;
    }
    this.pending = jobs.length - built;
    return this.pending;
  }

  /** 시작 시 주변을 한꺼번에 생성 */
  prime(camPos) { let n = 0; while (this.update(camPos, 1e9) > 0 && n++ < 3); }

  indexFor(n) {
    if (this.indexCache.has(n)) return this.indexCache.get(n);
    const v = n + 1, idx = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = y * v + x, b = a + 1, c = a + v, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // 가장자리 치마(skirt): 4변
    const base = v * v;
    const ring = [];
    for (let x = 0; x <= n; x++) ring.push(x);                     // 북
    for (let y = 1; y <= n; y++) ring.push(y * v + n);             // 동
    for (let x = n - 1; x >= 0; x--) ring.push(n * v + x);         // 남
    for (let y = n - 1; y >= 1; y--) ring.push(y * v);             // 서
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], sa = base + k, sb = base + (k + 1) % ring.length;
      idx.push(a, b, sa, b, sb, sa);
    }
    const arr = new THREE.BufferAttribute((base + ring.length) > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
    const res = { attr: arr, ring };
    this.indexCache.set(n, res);
    return res;
  }

  buildChunk({ key, i, j, lod }) {
    const n = lod, v = n + 1, step = CHUNK / n;
    const ox = i * CHUNK, oz = j * CHUNK;
    const { ring } = this.indexFor(n);
    const total = v * v + ring.length;
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    // 법선 계산용 테두리 포함 높이
    const H = new Float32Array((v + 2) * (v + 2));
    const AW = new Float32Array(v * v);
    const t = this.t;
    for (let y = -1; y <= n + 1; y++) for (let x = -1; x <= n + 1; x++) {
      const wx = ox + x * step, wz = oz + y * step;
      let h = t.rawHeight(wx, wz);
      if (x >= 0 && y >= 0 && x <= n && y <= n) {
        const a = t.airportWeight(wx, wz);
        if (a) { h += (a.elev - h) * a.w; AW[y * v + x] = a.w; }
      }
      H[(y + 1) * (v + 2) + (x + 1)] = h;
    }
    const c3 = [0, 0, 0];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
      const k = y * v + x;
      const h = H[(y + 1) * (v + 2) + (x + 1)];
      const hy = Math.max(0, h);
      const hl = Math.max(0, H[(y + 1) * (v + 2) + x]), hr = Math.max(0, H[(y + 1) * (v + 2) + x + 2]);
      const hu = Math.max(0, H[y * (v + 2) + x + 1]), hd = Math.max(0, H[(y + 2) * (v + 2) + x + 1]);
      const nx = (hl - hr) / (2 * step), nz = (hu - hd) / (2 * step);
      const len = Math.hypot(nx, 1, nz);
      pos[k * 3] = x * step; pos[k * 3 + 1] = hy; pos[k * 3 + 2] = y * step;
      nrm[k * 3] = nx / len; nrm[k * 3 + 1] = 1 / len; nrm[k * 3 + 2] = nz / len;
      const wx = ox + x * step, wz = oz + y * step;
      terrainColor(h, Math.hypot(nx, nz), wx, wz, AW[k], c3);
      col[k * 3] = c3[0]; col[k * 3 + 1] = c3[1]; col[k * 3 + 2] = c3[2];
      uv[k * 2] = wx / 300; uv[k * 2 + 1] = wz / 300;
    }
    // 치마 정점
    const drop = step * 0.6 + 20;
    for (let s = 0; s < ring.length; s++) {
      const src = ring[s], k = v * v + s;
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - drop; pos[k * 3 + 2] = pos[src * 3 + 2];
      nrm.copyWithin(k * 3, src * 3, src * 3 + 3); col.copyWithin(k * 3, src * 3, src * 3 + 3); uv.copyWithin(k * 2, src * 2, src * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(this.indexFor(n).attr);
    g.computeBoundingSphere();
    const old = this.chunks.get(key);
    let mesh;
    if (old) { mesh = old.mesh; mesh.geometry.dispose(); mesh.geometry = g; }
    else {
      mesh = new THREE.Mesh(g, this.mat);
      mesh.position.set(ox, 0, oz);
      mesh.receiveShadow = this.quality !== 'low';
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.group.add(mesh);
    }
    this.chunks.set(key, { mesh, lod, overDetail: old ? old.overDetail : this.overDetail(ox + CHUNK / 2, oz + CHUNK / 2) });
  }
}

function detailTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const g = 190 + Math.random() * 65 | 0;
    x.fillStyle = `rgb(${g},${g},${g})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
