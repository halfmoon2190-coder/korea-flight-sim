// 활주로 생성: 포장면, ICAO 표지, 등화(가장자리·중심선·시단·진입등), PAPI
import * as THREE from '../../vendor/three.module.min.js';

/**
 * def = { id, x, z, hdg(진방위, 33방향 기준), length, width, names:[정방향, 역방향], elev }
 * (x,z)는 활주로 중심점
 */
export function buildRunway(def) {
  const group = new THREE.Group();
  const L = def.length, W = def.width;
  const h = def.hdg * Math.PI / 180;
  const dir = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  const center = new THREE.Vector3(def.x, def.elev || 0, def.z);
  const thrA = center.clone().addScaledVector(dir, -L / 2);   // names[0] 시단 (이 방향으로 착륙)
  const thrB = center.clone().addScaledVector(dir, L / 2);    // names[1] 시단
  const y0 = (def.elev || 0);
  // layered: 평지 월드(깊이 비교 없이 순서대로 그림) / 아니면 지형 위에 살짝 띄워 깊이 비교 (로그 깊이 버퍼)
  const layered = def.layered !== false;
  const lift = layered ? { surf: 0, paint: 0 } : { surf: 0.12, paint: 0.22 };

  // u: thrA에서 활주로 방향 거리, v: 오른쪽 거리 → 월드
  const P = (u, v, y = 0) => new THREE.Vector3(
    thrA.x + dir.x * u + right.x * v, y0 + y, thrA.z + dir.z * u + right.z * v);

  // ── 포장면 ──
  // 지면 위 평면 층은 깊이 비교 없이 정해진 순서로 그림 (낮은 각도에서 깜빡임 방지)
  const asphalt = new THREE.MeshLambertMaterial({ map: asphaltTexture(), color: 0x9a9a9a, depthTest: !layered,
    polygonOffset: !layered, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const ext = 60; // 양끝 여유 포장
  const sy = lift.surf;
  const surf = quadGeo([[P(-ext, -W / 2 - 7.5, sy), P(L + ext, -W / 2 - 7.5, sy), P(L + ext, W / 2 + 7.5, sy), P(-ext, W / 2 + 7.5, sy)]], L / 40, 2);
  const surfMesh = new THREE.Mesh(surf, asphalt);
  surfMesh.receiveShadow = true;
  surfMesh.renderOrder = -5;
  group.add(surfMesh);

  // ── 표지 (흰색) ──
  const quads = [];
  const addQ = (u0, u1, v0, v1, flip) => {
    if (flip) { [u0, u1] = [L - u1, L - u0]; [v0, v1] = [-v1, -v0]; }
    quads.push([P(u0, v0, lift.paint), P(u1, v0, lift.paint), P(u1, v1, lift.paint), P(u0, v1, lift.paint)]);
  };
  for (const flip of [false, true]) {
    // 시단 표지 16줄
    for (let i = 0; i < 8; i++) {
      const vc = 2.7 + i * 3.6;
      addQ(6, 36, vc - 0.9, vc + 0.9, flip); addQ(6, 36, -vc - 0.9, -vc + 0.9, flip);
    }
    // 조준점 표지
    addQ(400, 460, 9, 19, flip); addQ(400, 460, -19, -9, flip);
    // 접지구역 표지
    const tdz = [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]];
    for (const [u, n] of tdz) {
      for (let k = 0; k < n; k++) {
        const v0 = 9 + k * 4.5;
        addQ(u, u + 22.5, v0, v0 + 3, flip); addQ(u, u + 22.5, -v0 - 3, -v0, flip);
      }
    }
  }
  // 중심선
  for (let u = 110; u < L - 140; u += 50) addQ(u, u + 30, -0.45, 0.45, false);
  // 가장자리선
  addQ(0, L, W / 2 - 0.9, W / 2, false); addQ(0, L, -W / 2, -W / 2 + 0.9, false);
  const paint = new THREE.MeshLambertMaterial({ color: 0xf2f2f2, depthTest: !layered, polygonOffset: !layered, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const paintMesh = new THREE.Mesh(quadGeo(quads), paint);
  paintMesh.renderOrder = -4; paintMesh.receiveShadow = true;
  group.add(paintMesh);

  // 활주로 번호
  for (const [k, name] of def.names.entries()) {
    const flip = k === 1;
    const tex = designatorTexture(name);
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, depthTest: !layered, polygonOffset: !layered, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const u0 = 45, u1 = 92, v = 9;
    const py = lift.paint;
    let corners = [P(u0, -v, py), P(u1, -v, py), P(u1, v, py), P(u0, v, py)];
    if (flip) corners = [P(L - u0, v, py), P(L - u1, v, py), P(L - u1, -v, py), P(L - u0, -v, py)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(p => [p.x, p.y, p.z]), 3));
    // 캔버스 아래(0) = 시단 쪽, 위(1) = 활주로 안쪽
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    const dm = new THREE.Mesh(g, m); dm.renderOrder = -3;
    group.add(dm);
  }

  // ── 등화 ──
  const lights = { white: [], green: [], red: [], amber: [] };
  for (let u = 0; u <= L; u += 60) { lights.white.push(P(u, W / 2 + 1.5, 0.4)); lights.white.push(P(u, -W / 2 - 1.5, 0.4)); }
  for (let u = 0; u <= L; u += 15) lights.white.push(P(u, 0, 0.1));
  for (let v = -W / 2; v <= W / 2; v += 3) { lights.green.push(P(-2, v, 0.3)); lights.green.push(P(L + 2, v, 0.3)); }
  // 진입등 (양방향, 900m)
  for (const flip of [false, true]) {
    for (let d = 30; d <= 900; d += 30) {
      for (let v = -3; v <= 3; v += 1.5) {
        const u = flip ? L + d : -d;
        lights.white.push(P(u, v, 1 + d * 0.002));
      }
      if (d === 300) for (let v = -15; v <= 15; v += 1.5) lights.white.push(P(flip ? L + d : -d, v, 1.6));
    }
  }
  const pts = [];
  const colors = { white: 0xfff6e0, green: 0x40ff60, red: 0xff3020, amber: 0xffb000 };
  for (const [k, arr] of Object.entries(lights)) {
    if (!arr.length) continue;
    const g = new THREE.BufferGeometry().setFromPoints(arr);
    const m = new THREE.PointsMaterial({ color: colors[k], size: 2.2, sizeAttenuation: false, fog: false });
    const p = new THREE.Points(g, m);
    pts.push(p); group.add(p);
  }

  // ── PAPI (왼쪽, 조준점 위치) ──
  const papi = [];
  for (const [k] of def.names.entries()) {
    const flip = k === 1;
    const unitPos = [];
    for (let i = 0; i < 4; i++) {
      const v = -(W / 2 + 15 + i * 9);
      unitPos.push(flip ? P(L - 400, -v, 0.8) : P(400, v, 0.8));
    }
    const g = new THREE.BufferGeometry().setFromPoints(unitPos);
    const col = new Float32Array(12).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, fog: false });
    const p = new THREE.Points(g, m);
    group.add(p);
    // 박스 본체
    for (const up of unitPos) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), new THREE.MeshLambertMaterial({ color: 0x333333 }));
      b.position.copy(up).setY(up.y - 0.4); group.add(b);
    }
    papi.push({ unitPos, points: p, angles: [3.5, 3.17, 2.83, 2.5] });
  }

  const rwy = {
    def, group, dir, right, center, L, W, papi,
    ends: [
      { name: def.names[0], thr: thrA, dir: dir.clone(), hdg: def.hdg },
      { name: def.names[1], thr: thrB, dir: dir.clone().negate(), hdg: (def.hdg + 180) % 360 },
    ],
    lightPoints: pts,
    /** 활주로 좌표 (u: 해당 시단부터 거리, v: 중심선 오른쪽 거리) */
    local(end, pos) {
      const d = new THREE.Vector3().subVectors(pos, end.thr);
      const r = new THREE.Vector3(-end.dir.z, 0, end.dir.x);
      return { u: d.x * end.dir.x + d.z * end.dir.z, v: d.x * r.x + d.z * r.z };
    },
    updatePapi(eye) {
      for (const P of papi) {
        const c = P.points.geometry.attributes.color;
        P.unitPos.forEach((up, i) => {
          const dx = eye.x - up.x, dz = eye.z - up.z;
          const ang = Math.atan2(eye.y - up.y, Math.hypot(dx, dz)) * 180 / Math.PI;
          const white = ang > P.angles[i];
          c.setXYZ(i, 1, white ? 1 : 0.1, white ? 1 : 0.08);
        });
        c.needsUpdate = true;
      }
    },
  };
  return rwy;
}

function quadGeo(quads, uRep = 1, vRep = 1) {
  const pos = [], uv = [], nrm = [], idx = [];
  quads.forEach((q, i) => {
    q.forEach(p => { pos.push(p.x, p.y, p.z); nrm.push(0, 1, 0); });
    uv.push(0, 0, uRep, 0, uRep, vRep, 0, vRep);
    const o = i * 4;
    idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // 앞면이 위를 향하도록 감기 방향 보정
  g.computeVertexNormals();
  const n = g.attributes.normal;
  if (n.getY(0) < 0) { g.setIndex(idx.map((_, i, a) => a[i - (i % 3) + [0, 2, 1][i % 3]])); g.computeVertexNormals(); }
  return g;
}

function asphaltTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#5a5a5a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const g = 70 + Math.random() * 40 | 0;
    x.fillStyle = `rgba(${g},${g},${g},0.35)`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  // 바퀴 자국(중앙부 어둡게)
  const grd = x.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.42, 'rgba(0,0,0,0.12)');
  grd.addColorStop(0.5, 'rgba(0,0,0,0.18)'); grd.addColorStop(0.58, 'rgba(0,0,0,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function designatorTexture(name) {
  const m = name.match(/^(\d+)([LRC]?)$/);
  const num = m ? m[1] : name, letter = m ? m[2] : '';
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 230px Arial, sans-serif';
  // 착륙 방향에서 읽히도록: 캔버스 위쪽 = 활주로 안쪽 → 숫자를 위, 문자를 아래(시단 쪽)
  x.fillText(num, 128, letter ? 150 : 256, 250);
  if (letter) x.fillText(letter, 128, 390, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
