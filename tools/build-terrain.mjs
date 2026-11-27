// 지형 높이맵 생성 스크립트
//   node tools/build-terrain.mjs
// 출처: AWS Open Data "Terrain Tiles" (Terrarium 형식, SRTM·GMTED·ETOPO1 등 공개 자료 기반)
// 결과: data/terrain/*.png (R=상위바이트, G=하위바이트, 값 = (고도m + 500) × 4), meta.json
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'data', 'terrain');
const CACHE = path.join(ROOT, '.cache', 'tiles');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

const SCALE = 4, OFFSET = 500;

const GRIDS = [
  { name: 'base', lat0: 32.9, lat1: 38.7, lon0: 124.8, lon1: 130.0, step: 1 / 240, zoom: 9 },
  { name: 'RKSI', ...around(37.4691, 126.4510), step: 1 / 1800, zoom: 12 },
  { name: 'RKPK', ...around(35.1795, 128.9380), step: 1 / 1800, zoom: 12 },
  { name: 'RKPC', ...around(33.5121, 126.4925), step: 1 / 1800, zoom: 12 },
];
function around(lat, lon) { return { lat0: lat - 0.30, lat1: lat + 0.30, lon0: lon - 0.36, lon1: lon + 0.36 }; }

const tileMem = new Map();
async function getTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileMem.has(key)) return tileMem.get(key);
  const file = path.join(CACHE, `${z}_${x}_${y}.png`);
  let buf;
  if (fs.existsSync(file)) buf = fs.readFileSync(file);
  else {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        buf = Buffer.from(await r.arrayBuffer());
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
      }
    }
    fs.writeFileSync(file, buf);
  }
  const png = PNG.sync.read(buf);
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    h[i] = r * 256 + g + b / 256 - 32768;
  }
  tileMem.set(key, h);
  return h;
}

// 웹 메르카토르 픽셀 좌표
function merc(lat, lon, z) {
  const n = 256 * Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const s = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

async function build(g) {
  const w = Math.round((g.lon1 - g.lon0) / g.step) + 1;
  const h = Math.round((g.lat1 - g.lat0) / g.step) + 1;
  // 필요한 타일 미리 받기
  const [x0, y0] = merc(g.lat1, g.lon0, g.zoom), [x1, y1] = merc(g.lat0, g.lon1, g.zoom);
  const tiles = [];
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++)
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) tiles.push([tx, ty]);
  process.stdout.write(`${g.name}: ${w}×${h}, 타일 ${tiles.length}개 (z${g.zoom}) `);
  for (let i = 0; i < tiles.length; i += 8) {
    await Promise.all(tiles.slice(i, i + 8).map(([tx, ty]) => getTile(g.zoom, tx, ty)));
    process.stdout.write('.');
  }
  const sample = (px, py) => {
    const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
    const t = tileMem.get(`${g.zoom}/${tx}/${ty}`);
    const ix = Math.min(255, Math.max(0, Math.floor(px - tx * 256))), iy = Math.min(255, Math.max(0, Math.floor(py - ty * 256)));
    return t[iy * 256 + ix];
  };
  const out = new PNG({ width: w, height: h, colorType: 2 });
  let minH = 1e9, maxH = -1e9;
  for (let j = 0; j < h; j++) {
    const lat = g.lat1 - j * g.step;
    for (let i = 0; i < w; i++) {
      const lon = g.lon0 + i * g.step;
      const [px, py] = merc(lat, lon, g.zoom);
      // 쌍선형 보간
      const fx = px - 0.5, fy = py - 0.5;
      const ax = Math.floor(fx), ay = Math.floor(fy), dx = fx - ax, dy = fy - ay;
      const v = sample(ax, ay) * (1 - dx) * (1 - dy) + sample(ax + 1, ay) * dx * (1 - dy)
              + sample(ax, ay + 1) * (1 - dx) * dy + sample(ax + 1, ay + 1) * dx * dy;
      minH = Math.min(minH, v); maxH = Math.max(maxH, v);
      const q = Math.max(0, Math.min(65535, Math.round((Math.max(-OFFSET, v) + OFFSET) * SCALE)));
      const k = (j * w + i) * 4;
      out.data[k] = q >> 8; out.data[k + 1] = q & 255; out.data[k + 2] = 0; out.data[k + 3] = 255;
    }
  }
  const file = `${g.name}.png`;
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(out, { colorType: 2 }));
  const size = fs.statSync(path.join(OUT, file)).size;
  console.log(` → ${file} ${(size / 1024).toFixed(0)}KB, 고도 ${minH.toFixed(0)}~${maxH.toFixed(0)}m`);
  return { name: g.name, file, lat0: g.lat0, lat1: g.lat1, lon0: g.lon0, lon1: g.lon1, w, h, step: g.step };
}

const meta = { scale: SCALE, offset: OFFSET, source: 'AWS Terrain Tiles (Terrarium) — SRTM, GMTED2010, ETOPO1 등', grids: [] };
for (const g of GRIDS) meta.grids.push(await build(g));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log('완료:', path.join(OUT, 'meta.json'));
