// 2단계 월드: 한반도 지형 + 인천 · 김해 · 제주 공항
import * as THREE from '../../vendor/three.module.min.js';
import { toWorld, toLatLon, convergence, greatCircle } from '../geo/proj.js';
import { AIRPORTS } from '../geo/airports.js';
import { loadHeightmaps, Terrain, TerrainRenderer, CITIES } from './terrain.js';
import { buildRunway } from './runway.js';
import { mulberry } from './world.js';

/** 공항 정의 → 월드 좌표 기하 */
function prepareAirport(ap) {
  const elev = ap.elevFt * 0.3048;
  const runways = ap.runways.map(r => {
    const A = toWorld(...r.a), B = toWorld(...r.b);
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
    const dir = { x: dx / len, z: dz / len };
    return {
      ...r, A, B, dir,
      center: { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 },
      hdg: (Math.atan2(dir.x, -dir.z) * 180 / Math.PI + 360) % 360,
      L: r.lenFt * 0.3048, W: Math.round(r.widFt * 0.3048),
    };
  });
  const local = (ref, u, v) => {
    const r = runways.find(x => x.le === ref) || runways[0];
    const rt = { x: -r.dir.z, z: r.dir.x };
    return { x: r.center.x + r.dir.x * u + rt.x * v, z: r.center.z + r.dir.z * u + rt.z * v, dir: r.dir, rt };
  };
  const terminals = ap.terminals.map(t => {
    const p = local(t.ref, t.u, t.v);
    return { ...t, center: { x: p.x, z: p.z }, dir: p.dir, rt: p.rt };
  });
  const tw = local(ap.tower.ref, ap.tower.u, ap.tower.v);
  const c = toWorld(ap.lat, ap.lon);
  return { elev, runways, terminals, tower: new THREE.Vector3(tw.x, elev + 60, tw.z), pos: c, conv: convergence(ap.lon) };
}

export async function createKoreaWorld(scene, quality, onProgress) {
  const hm = await loadHeightmaps('data/terrain/', (f) => onProgress?.(f * 0.7));
  const airports = AIRPORTS.map(ap => ({ ...ap, geo: prepareAirport(ap) }));
  const terrain = new Terrain(hm, airports);
  const tr = new TerrainRenderer(terrain, quality);
  const group = new THREE.Group();
  group.add(tr.group);

  // ── 공항 시설 ──
  const runways = [];
  for (const ap of airports) {
    ap.runwayObjs = [];
    for (const r of ap.geo.runways) {
      const rwy = buildRunway({
        id: `${r.le}/${r.he}`, x: r.center.x, z: r.center.z, hdg: r.hdg, length: r.L, width: r.W,
        names: [r.le, r.he], elev: ap.geo.elev, layered: false,
      });
      rwy.airport = ap;
      group.add(rwy.group);
      runways.push(rwy); ap.runwayObjs.push(rwy);
    }
    group.add(buildFacilities(ap, quality));
  }
  onProgress?.(0.8);

  // ── 도시 건물 ──
  group.add(buildCities(terrain, quality));
  onProgress?.(0.9);

  return {
    kind: 'korea', group, runways, airports, terrain, terrainRenderer: tr,
    groundAt: (x, z) => terrain.groundAt(x, z),
    isWater: (x, z) => terrain.isWater(x, z),
    hdgOffset(x, z) { return convergence(toLatLon(x, z).lon); },
    towerFor(pos) {
      let best = null, bd = Infinity;
      for (const ap of airports) { const d = Math.hypot(pos.x - ap.geo.tower.x, pos.z - ap.geo.tower.z); if (d < bd) { bd = d; best = ap.geo.tower; } }
      return best;
    },
    prime(camPos) { tr.prime(camPos); },
    update(camPos, acPos) {
      tr.update(camPos);
      for (const r of runways) {
        if (Math.abs(camPos.x - r.center.x) < 25000 && Math.abs(camPos.z - r.center.z) < 25000) r.updatePapi(camPos);
      }
    },
    nav(acPos, destIcao) {
      const ap = airports.find(a => a.icao === destIcao);
      if (!ap) return null;
      const ll = toLatLon(acPos.x, acPos.z);
      const gc = greatCircle(ll.lat, ll.lon, ap.lat, ap.lon);
      return { ap, distNm: gc.dist / 1852, brgTrue: gc.brg, lat: ll.lat, lon: ll.lon };
    },
  };
}

/* 유도로 · 계류장 · 터미널 · 관제탑 */
function buildFacilities(ap, quality) {
  const g = new THREE.Group();
  const elev = ap.geo.elev;
  const conc = new THREE.MeshLambertMaterial({ color: 0x8e8e8a, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const termMat = new THREE.MeshLambertMaterial({ color: 0xc0ccd4 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6f8796 });
  const plane = (cx, cz, dir, len, wid, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wid, len), conc);
    m.geometry.rotateX(-Math.PI / 2);
    m.position.set(cx, elev + y, cz);
    m.rotation.y = -Math.atan2(dir.x, -dir.z);
    m.receiveShadow = quality !== 'low';
    g.add(m); return m;
  };
  for (const r of ap.geo.runways) {
    if (!r.twy) continue;
    const rt = { x: -r.dir.z, z: r.dir.x }, s = r.twy.side, off = r.twy.off;
    plane(r.center.x + rt.x * off * s, r.center.z + rt.z * off * s, r.dir, r.L - 150, 23, 0.08);
    for (const u of [-r.L / 2 + 80, -r.L / 4, 0, r.L / 4, r.L / 2 - 80]) {
      const vMid = (r.W / 2 + off) / 2 * s;
      const m = plane(r.center.x + r.dir.x * u + rt.x * vMid, r.center.z + r.dir.z * u + rt.z * vMid, rt, off - r.W / 2, 23, 0.07);
      void m;
    }
  }
  for (const t of ap.geo.terminals) {
    // 계류장 (터미널 앞, 활주로 쪽)
    const side = Math.sign(t.v) || 1;
    const ac = { x: t.center.x - t.rt.x * side * (t.wid / 2 + t.apron / 2), z: t.center.z - t.rt.z * side * (t.wid / 2 + t.apron / 2) };
    plane(ac.x, ac.z, t.dir, t.len + 120, t.apron, 0.06);
    const b = new THREE.Mesh(new THREE.BoxGeometry(t.wid, t.h, t.len), termMat);
    b.position.set(t.center.x, elev + t.h / 2, t.center.z);
    b.rotation.y = -Math.atan2(t.dir.x, -t.dir.z);
    b.castShadow = b.receiveShadow = quality !== 'low';
    g.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(t.wid + 14, 3, t.len + 20), roofMat);
    roof.position.set(t.center.x, elev + t.h + 1.5, t.center.z); roof.rotation.y = b.rotation.y;
    g.add(roof);
    // 탑승교 (간단한 막대)
    for (let k = -3; k <= 3; k++) {
      const jb = new THREE.Mesh(new THREE.BoxGeometry(30, 4, 4), termMat);
      const u = k * t.len / 8;
      jb.position.set(t.center.x + t.dir.x * u - t.rt.x * side * (t.wid / 2 + 15), elev + 5, t.center.z + t.dir.z * u - t.rt.z * side * (t.wid / 2 + 15));
      jb.rotation.y = b.rotation.y + Math.PI / 2;
      g.add(jb);
    }
  }
  const tw = ap.geo.tower;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 60, 12), new THREE.MeshLambertMaterial({ color: 0xd8d8d0 }));
  shaft.position.set(tw.x, elev + 30, tw.z); g.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(10, 8, 9, 12), new THREE.MeshLambertMaterial({ color: 0x2c4a5c }));
  cab.position.set(tw.x, elev + 64, tw.z); g.add(cab);
  return g;
}

/* 도시 건물 (도시마다 인스턴스 1개) */
function buildCities(terrain, quality) {
  const g = new THREE.Group();
  const dens = quality === 'low' ? 0.35 : quality === 'medium' ? 0.7 : 1.1;
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const rnd = mulberry(42);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  for (const ct of CITIES) {
    const n = Math.round(Math.min(4000, ct.r * ct.r / 1e6 * 22 * dens));
    const inst = new THREE.InstancedMesh(box, mat, n);
    let k = 0;
    for (let i = 0; i < n * 2 && k < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * ct.r * 1.05;
      const x = ct.x + Math.cos(a) * d, z = ct.z + Math.sin(a) * d;
      const h0 = terrain.height(x, z);
      if (h0 <= 1 || h0 > 220) continue;
      if (terrain.airportWeight(x, z)) continue;
      const hn = terrain.height(x + 60, z);
      if (Math.abs(hn - h0) > 18) continue;
      const core = 1 - d / (ct.r * 1.05);
      const tall = rnd() < core * 0.5;
      const w = 15 + rnd() * 30, dd = 15 + rnd() * 30;
      const hh = tall ? 30 + rnd() * (ct.r > 9000 ? 120 : 70) : 8 + rnd() * 18;
      m.makeScale(w, hh, dd); m.setPosition(x, h0 - 2, z);
      inst.setMatrixAt(k, m);
      const s = 0.65 + rnd() * 0.35;
      inst.setColorAt(k, col.setRGB(s, s * (0.96 + rnd() * 0.04), s * (0.9 + rnd() * 0.1)));
      k++;
    }
    inst.count = k;
    inst.computeBoundingSphere();
    g.add(inst);
  }
  return g;
}
