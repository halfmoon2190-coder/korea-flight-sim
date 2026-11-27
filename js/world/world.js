// 1단계 연습 월드: 평지 + 서쪽 바다 + 원경 산 + 연습 공항(인천 33L/15R 규격 활주로)
import * as THREE from '../../vendor/three.module.min.js';
import { buildRunway } from './runway.js';

export const PRACTICE_AIRPORT = {
  name: '연습 공항',
  icao: 'TRNG',
  runways: [
    // 중심점 (0,0), 진방위 330° → 33L 착륙 방향, 3750m × 60m (인천 33L 규격)
    { id: '33L/15R', x: 0, z: 0, hdg: 330, length: 3750, width: 60, names: ['33L', '15R'], elev: 0 },
  ],
};

const SKY_TOP = new THREE.Color(0x3d7fd6);
const SKY_HORIZON = new THREE.Color(0xc4dcef);

/** 하늘 · 빛 · 안개 (모든 월드 공통) */
export function createEnvironment(scene, quality) {
  const q = quality;
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON.getHex(), 2000, 34000);
  const skyGeo = new THREE.SphereGeometry(1, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.45));
      if (vP.y < 0.0) c = horizon * 0.95; gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -100; sky.frustumCulled = false;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x5d6b45, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.1);
  sun.position.set(-3000, 6000, 2500);
  scene.add(sun); scene.add(sun.target);
  if (q !== 'low') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 12000 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
  }
  const sunDir = sun.position.clone().normalize();
  return {
    sun, sky,
    /** 시야: 고도가 높을수록 멀리 */
    update(camera, acPos, baseFar) {
      sky.position.copy(camera.position);
      sky.scale.setScalar(camera.far * 0.9);
      const far = baseFar + Math.min(70000, Math.max(0, camera.position.y) * 6);
      scene.fog.near = Math.max(1500, far * 0.08 + Math.max(0, camera.position.y) * 1.6);   // 고고도에서는 아래 지형이 덜 뿌옇게
      scene.fog.far = far;
      if (Math.abs(camera.far - far * 1.15) > 500) { camera.far = far * 1.15; camera.updateProjectionMatrix(); }
      if (sun.castShadow) {
        sun.target.position.copy(acPos);
        sun.position.copy(acPos).addScaledVector(sunDir, 3000);
      }
    },
  };
}

/** 1단계 연습 월드 (평지) */
export function createPracticeWorld(scene, quality) {
  const q = quality;
  const group = new THREE.Group();
  scene.add(group);

  const groundSize = 120000;
  const groundMat = new THREE.MeshLambertMaterial({ map: fieldsTexture(), color: 0xffffff });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.material.map.repeat.set(groundSize / 6000, groundSize / 6000);
  ground.receiveShadow = q !== 'low';
  groundMat.depthTest = false; ground.renderOrder = -9;
  group.add(ground);

  // 공항 부지 잔디 (활주로 방향 4.8km × 폭 1.5km)
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTexture(), depthTest: false });
  grassMat.map.repeat.set(12, 60);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(1500, 4800), grassMat);
  grass.geometry.rotateX(-Math.PI / 2);
  grass.rotation.y = -330 * Math.PI / 180;
  { const h = 330 * Math.PI / 180; grass.position.set(Math.cos(h) * 350, 0, Math.sin(h) * 350); }
  grass.receiveShadow = q !== 'low';
  grass.renderOrder = -7;
  group.add(grass);

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 120000),
    new THREE.MeshLambertMaterial({ color: 0x3f6f8f, depthTest: false }));
  sea.renderOrder = -8;
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-38000, 0, 0);
  group.add(sea);

  const hills = new THREE.Group();
  const hillMat = new THREE.MeshLambertMaterial({ color: 0x5f7a52, flatShading: true });
  const rnd = mulberry(7);
  for (let i = 0; i < 26; i++) {
    const ang = rnd() * Math.PI * 1.3 - Math.PI * 0.15;
    const dist = 11000 + rnd() * 18000;
    const r = 2500 + rnd() * 4500, hgt = 300 + rnd() * 900;
    const geo = new THREE.ConeGeometry(r, hgt, 9, 3);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) > -hgt / 2 + 1) {
        pos.setX(k, pos.getX(k) * (0.75 + rnd() * 0.5));
        pos.setZ(k, pos.getZ(k) * (0.75 + rnd() * 0.5));
        pos.setY(k, pos.getY(k) + (rnd() - 0.5) * hgt * 0.15);
      }
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, hillMat);
    m.position.set(Math.cos(ang) * dist, hgt / 2 - 5, -Math.sin(ang) * dist);
    m.scale.set(1, 1, 0.7 + rnd() * 0.6);
    m.rotation.y = rnd() * 6;
    hills.add(m);
  }
  group.add(hills);

  const runways = PRACTICE_AIRPORT.runways.map(def => buildRunway(def));
  runways.forEach(r => group.add(r.group));
  const apron = buildApron(runways[0], q);
  group.add(apron);
  group.add(buildTowns(q, rnd));

  return {
    kind: 'practice', group, runways,
    airport: PRACTICE_AIRPORT,
    groundAt: () => 0,
    isWater: () => false,
    hdgOffset: () => 0,
    towerFor: () => apron.userData.towerPos,
    update(camPos) { for (const r of runways) r.updatePapi(camPos); },
  };
}

function buildApron(rwy, q) {
  const g = new THREE.Group();
  const conc = new THREE.MeshLambertMaterial({ color: 0x8c8c88, depthTest: false });
  const R = rwy.right, D = rwy.dir, C = rwy.center;
  const place = (mesh, u, v, y = 0) => {
    if (mesh.material === conc) { mesh.renderOrder = -6; mesh.receiveShadow = true; y = 0; }
    mesh.position.set(C.x + D.x * u + R.x * v, y, C.z + D.z * u + R.z * v);
    mesh.rotation.y = -rwy.def.hdg * Math.PI / 180;
    g.add(mesh); return mesh;
  };
  // 평행 유도로 (활주로 동쪽 200m)
  const twy = new THREE.Mesh(new THREE.PlaneGeometry(23, rwy.L - 200), conc);
  twy.geometry.rotateX(-Math.PI / 2);
  place(twy, 0, 200, 0.02);
  // 연결 유도로
  for (const u of [-rwy.L / 2 + 60, -rwy.L / 4, 0, rwy.L / 4, rwy.L / 2 - 60]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(23, 160), conc);   // 활주로 가장자리(37.5m)부터 평행 유도로까지
    c.geometry.rotateX(-Math.PI / 2); c.geometry.rotateY(Math.PI / 2);
    place(c, u, 118, 0.02);
  }
  // 계류장
  const ap = new THREE.Mesh(new THREE.PlaneGeometry(260, 900), conc);
  ap.geometry.rotateX(-Math.PI / 2);
  place(ap, 0, 360, 0.02);
  // 터미널
  const term = new THREE.Mesh(new THREE.BoxGeometry(60, 18, 800), new THREE.MeshLambertMaterial({ color: 0xb8c4cc }));
  term.castShadow = term.receiveShadow = q !== 'low';
  place(term, 0, 530, 9);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(70, 3, 820), new THREE.MeshLambertMaterial({ color: 0x6f8796 }));
  place(roof, 0, 530, 19);
  // 관제탑
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 90, 12), new THREE.MeshLambertMaterial({ color: 0xd8d8d0 }));
  place(tw, 450, 560, 45);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(11, 9, 10, 12), new THREE.MeshLambertMaterial({ color: 0x2c4a5c }));
  place(cab, 450, 560, 95);
  // 격납고
  for (let i = 0; i < 3; i++) {
    const hg = new THREE.Mesh(new THREE.BoxGeometry(90, 28, 110), new THREE.MeshLambertMaterial({ color: 0xa0a6a8 }));
    place(hg, -1100 + i * 130, 420, 14);
  }
  g.userData.towerPos = new THREE.Vector3(C.x + D.x * 450 + R.x * 560, 100, C.z + D.z * 450 + R.z * 560);
  return g;
}

function buildTowns(q, rnd) {
  const g = new THREE.Group();
  const nTown = q === 'low' ? 8 : q === 'medium' ? 14 : 22;
  const perTown = q === 'low' ? 60 : q === 'medium' ? 110 : 180;
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(box, mat, nTown * perTown);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  let n = 0;
  for (let t = 0; t < nTown; t++) {
    let cx, cz;
    do { cx = (rnd() - 0.3) * 30000; cz = (rnd() - 0.5) * 30000; } while (Math.hypot(cx, cz) < 4500 || cx < -7000);
    const big = rnd() < 0.3;
    for (let i = 0; i < perTown; i++) {
      const x = cx + (rnd() - 0.5) * (big ? 2200 : 1100), z = cz + (rnd() - 0.5) * (big ? 2200 : 1100);
      const tall = big && rnd() < 0.35;
      const w = 12 + rnd() * 25, d = 12 + rnd() * 25, h = tall ? 30 + rnd() * 70 : 6 + rnd() * 12;
      m.makeScale(w, h, d); m.setPosition(x, 0, z);
      inst.setMatrixAt(n, m);
      const s = 0.7 + rnd() * 0.3;
      inst.setColorAt(n, col.setRGB(s, s * (0.95 + rnd() * 0.05), s * (0.9 + rnd() * 0.1)));
      n++;
    }
  }
  inst.count = n;
  g.add(inst);

  // 나무 (공항 주변 띠)
  const nTree = q === 'low' ? 800 : q === 'medium' ? 2000 : 4000;
  const cone = new THREE.ConeGeometry(4, 12, 6); cone.translate(0, 6, 0);
  const trees = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0x3b5e2b }), nTree);
  for (let i = 0; i < nTree; i++) {
    let x, z;
    do { x = (rnd() - 0.5) * 16000; z = (rnd() - 0.5) * 16000; } while (Math.abs(rotU(x, z)) < 2400 && Math.abs(rotV(x, z)) < 800 || x < -6000);
    const s = 0.7 + rnd() * 0.9;
    m.makeScale(s, s, s); m.setPosition(x, 0, z);
    trees.setMatrixAt(i, m);
  }
  g.add(trees);
  return g;
}
// 활주로(330°) 좌표계 회전 헬퍼
const H = 330 * Math.PI / 180;
const rotU = (x, z) => x * Math.sin(H) - z * Math.cos(H);
const rotV = (x, z) => x * Math.cos(H) + z * Math.sin(H);

function fieldsTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#6f8a4e'; x.fillRect(0, 0, 512, 512);
  const rnd = mulberry(3);
  const pal = ['#7a9655', '#8aa060', '#66823f', '#a39a62', '#94a86a', '#5d7a3c', '#b0a874', '#748f50'];
  for (let i = 0; i < 260; i++) {
    x.fillStyle = pal[(rnd() * pal.length) | 0];
    const w = 20 + rnd() * 70, h = 15 + rnd() * 60;
    x.save(); x.translate(rnd() * 512, rnd() * 512); x.rotate((rnd() - 0.5) * 0.3);
    x.fillRect(-w / 2, -h / 2, w, h); x.restore();
  }
  for (let i = 0; i < 6000; i++) {
    x.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
    x.fillRect(rnd() * 512, rnd() * 512, 2, 2);
  }
  // 도로
  x.strokeStyle = 'rgba(120,120,110,0.8)'; x.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(rnd() * 512, 0); x.lineTo(rnd() * 512, 512); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function grassTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#7a9452'; x.fillRect(0, 0, 256, 256);
  const rnd = mulberry(11);
  for (let i = 0; i < 12000; i++) {
    const g = 110 + rnd() * 60 | 0;
    x.fillStyle = `rgba(${g * 0.55 | 0},${g},${g * 0.4 | 0},0.35)`;
    x.fillRect(rnd() * 256, rnd() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export function mulberry(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
