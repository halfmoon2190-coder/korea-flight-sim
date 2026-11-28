// 절차적으로 만든 KF-320 기체 모델 (가상 항공사 도색)
// 좌표: x 오른쪽, y 위, z 꼬리 쪽 (기수 = -z), 무게중심 = 원점
import * as THREE from '../../vendor/three.module.min.js';
import { AC } from '../sim/a320.js';

export function buildAircraftModel(quality) {
  const root = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f6f8 });
  const grey = new THREE.MeshLambertMaterial({ color: 0xb4bcc4 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x30363d });
  const blue = new THREE.MeshLambertMaterial({ color: 0x1f5fae });
  const teal = new THREE.MeshLambertMaterial({ color: 0x26b3c9 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x14202c });
  const metal = new THREE.MeshLambertMaterial({ color: 0x8a9096 });
  const tire = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const seg = quality === 'low' ? 14 : 22;

  const R = 1.98, cy = -0.12;
  // 동체 (원통) z: -10.5 ~ 13
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 23.5, seg, 1, true), white);
  body.rotation.x = Math.PI / 2; body.position.set(0, cy, 1.25);
  root.add(body);
  // 기수
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R, seg, 12, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.scale.set(1, 3.0, 1); nose.rotation.x = -Math.PI / 2; nose.position.set(0, cy, -10.5);
  root.add(nose);
  // 꼬리 원뿔 z: 13 ~ 21 (위로 휘어 올라감)
  const tailG = new THREE.CylinderGeometry(0.35, R, 8, seg, 4, true);
  tailG.rotateX(Math.PI / 2); tailG.translate(0, 0, 4);
  const tp = tailG.attributes.position;
  for (let i = 0; i < tp.count; i++) { const z = tp.getZ(i); tp.setY(i, tp.getY(i) + (z / 8) * (z / 8) * 1.3); }
  tailG.computeVertexNormals();
  const tail = new THREE.Mesh(tailG, white); tail.position.set(0, cy, 13); root.add(tail);
  // 하부(회색) 띠 & 도색 띠
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.01, R + 0.01, 23.5, seg, 1, true, Math.PI * 0.62, Math.PI * 0.76), grey);
  belly.rotation.x = Math.PI / 2; belly.position.copy(body.position); root.add(belly);
  for (const [side, phi] of [[1, Math.PI * 0.40], [-1, Math.PI * 1.48]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 23.5, seg, 1, true, phi, 0.12), blue);
    st.rotation.x = Math.PI / 2; st.position.copy(body.position); root.add(st);
    const st2 = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 23.5, seg, 1, true, phi + (side > 0 ? 0.14 : -0.08), 0.06), teal);
    st2.rotation.x = Math.PI / 2; st2.position.copy(body.position); root.add(st2);
  }
  // 객실 창문 띠
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(21, 0.28), dark);
    win.position.set(s * (R + 0.03), cy + 0.45, 1.6); win.rotation.y = s * Math.PI / 2;
    root.add(win);
  }
  // 조종석 창
  const cw = new THREE.Mesh(new THREE.SphereGeometry(R * 1.005, 16, 6, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.30, Math.PI * 0.14), glass);
  cw.scale.set(1, 1, 3.0); cw.rotation.y = Math.PI; cw.position.set(0, cy, -10.5);
  root.add(cw);

  // 주날개 (후퇴각 25°, 상반각 5°)
  const wingMat = white;
  const wingL = makeWing(-1, wingMat), wingR = makeWing(1, wingMat);
  root.add(wingL, wingR);
  // 플랩 (뒷전) — 회전으로 표현
  const flaps = [];
  for (const s of [-1, 1]) {
    for (const [a, b] of [[2.2, 7.5], [7.7, 13.5]]) {
      const f = makePanel(s, a, b, 0.32, 0.18, grey);
      root.add(f.pivot); flaps.push(f);
    }
  }
  // 스포일러 (날개 윗면)
  const spoilers = [];
  for (const s of [-1, 1]) {
    for (const [a, b] of [[3, 7], [7.5, 12]]) {
      const sp = makePanel(s, a, b, 0.20, 0.30, grey, true);
      root.add(sp.pivot); spoilers.push(sp);
    }
  }
  // 엔진
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.85, 4.2, seg, 1, true), grey);
    nac.rotation.x = Math.PI / 2; eg.add(nac);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 8, seg), metal);
    lip.position.z = -2.1; eg.add(lip);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.92, seg), dark);
    fan.position.z = -1.9; fan.rotation.y = Math.PI; eg.add(fan);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 12), metal);
    cone.rotation.x = Math.PI / 2; cone.position.z = 2.6; eg.add(cone);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.0, 3.6), white);
    pylon.position.set(0, 1.0, 0.6); eg.add(pylon);
    eg.position.set(s * 5.75, -1.42, -3.5);
    root.add(eg);
  }
  // 수평꼬리날개
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(6.2, 2.8); sh.lineTo(6.2, 4.2); sh.lineTo(0, 4.0); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false });
    g.rotateX(Math.PI / 2); // shape (x=span, y=chord) → (x, z)
    const m = new THREE.Mesh(g, white);
    m.scale.x = s; m.position.set(0, 0.85, 16.3);
    m.rotation.z = s * 6 * Math.PI / 180;
    root.add(m);
  }
  // 수직꼬리날개
  {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(6.2, 0); sh.lineTo(8.0, 6.6); sh.lineTo(5.6, 6.6); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false });
    g.rotateY(-Math.PI / 2); // x(chord) → z
    g.translate(0.15, 0, 0);
    const fin = new THREE.Mesh(g, blue);
    fin.position.set(0, 1.4, 13.6);
    root.add(fin);
    // 꼬리 로고 (가상 항공사 KF)
    const logo = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20), teal);
    for (const s of [-1, 1]) {
      const l = logo.clone(); l.position.set(s * 0.17, 4.6, 19.2); l.rotation.y = s * Math.PI / 2; root.add(l);
    }
  }

  // 랜딩기어
  const gear = [];
  const mkGear = (gdef, wheelR, nW, spacing) => {
    const g = new THREE.Group();
    const [gx, gy, gz] = gdef.p;
    const top = gdef.name === 'nose' ? -1.8 : -1.5;
    const len = (top - (gy + wheelR));
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, Math.abs(len), 8), metal);
    strut.position.set(0, (top + gy + wheelR) / 2, 0);
    g.add(strut);
    const wheels = new THREE.Group();
    for (let i = 0; i < nW; i++) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.35, 14), tire);
      w.rotation.z = Math.PI / 2;
      w.position.set((i - (nW - 1) / 2) * spacing, gy + wheelR, 0);
      wheels.add(w);
    }
    g.add(wheels);
    g.position.set(gx, 0, gz);
    root.add(g);
    gear.push({ group: g, wheels, def: gdef, top, stowY: 1.6 });
  };
  mkGear(AC.gear[0], 0.38, 2, 0.5);
  mkGear(AC.gear[1], 0.57, 2, 0.95);
  mkGear(AC.gear[2], 0.57, 2, 0.95);

  // 항법등 · 충돌방지등
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  navL.position.set(-17.05, -0.15, 4.5); root.add(navL);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
  navR.position.set(17.05, -0.15, 4.5); root.add(navR);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff3010 }));
  beacon.position.set(0, cy + R + 0.1, 0); root.add(beacon);

  root.traverse(o => { if (o.isMesh) { o.castShadow = quality !== 'low'; } });

  return {
    root,
    update(ac, time) {
      // 플랩: 0~40°
      const fdeg = [0, 10, 15, 20, 40];
      const fp = ac.flapPos, i = Math.min(3, Math.floor(fp));
      const fa = (fdeg[i] + (fdeg[i + 1] - fdeg[i]) * (fp - i)) * Math.PI / 180;
      flaps.forEach(f => { f.pivot.rotation.x = 0; f.hinge.rotation.x = fa; });
      // 스포일러: 스피드브레이크 + 지상스포일러 + 롤
      const base = Math.max(ac.sbPos * 0.6, ac.gsPos);
      spoilers.forEach((s, k) => {
        const side = k < 2 ? -1 : 1;
        const roll = Math.max(0, -side * ac.ail) * 0.6;
        s.hinge.rotation.x = -Math.min(1, base + roll) * 50 * Math.PI / 180;
      });
      // 기어: 접힘 + 압축
      gear.forEach((g, k) => {
        const comp = ac.gearComp ? ac.gearComp[k] || 0 : 0;
        const down = ac.gearPos;
        g.group.visible = down > 0.02;
        g.group.position.y = (1 - down) * g.stowY;
        g.wheels.position.y = comp;
        g.group.scale.y = 0.3 + 0.7 * down;
        if (k === 0) g.group.rotation.y = -ac.steer;
      });
      beacon.visible = Math.sin(time * 6) > 0.6;
    },
  };
}

// 날개 한쪽: 뿌리(z: -2.6 ~ 4.0) → 끝(span 17, z: 4.6 ~ 6.1)
function makeWing(s, mat) {
  const span = 17.05, rootLE = -2.6, rootTE = 4.2, tipLE = 4.7, tipTE = 6.2;
  const y0 = -1.45, dihedral = 5 * Math.PI / 180;
  const pos = [];
  const thick = (t) => 0.55 * (1 - t) + 0.14 * t;
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = 1.6 + t * (span - 1.6);
    const le = rootLE + (tipLE - rootLE) * t, te = rootTE + (tipTE - rootTE) * t;
    const y = y0 + (x - 1.6) * Math.tan(dihedral);
    const th = thick(t);
    pos.push([s * x, y + th * 0.5, le], [s * x, y + th, le + (te - le) * 0.3], [s * x, y + th * 0.2, te],
             [s * x, y - th * 0.1, te], [s * x, y - th * 0.4, le + (te - le) * 0.3], [s * x, y - th * 0.15, le]);
  }
  const verts = [], idx = [];
  pos.forEach(p => verts.push(...p));
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 6; k++) {
      const a = i * 6 + k, b = i * 6 + (k + 1) % 6, c = (i + 1) * 6 + k, d = (i + 1) * 6 + (k + 1) % 6;
      if (s > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.material = mat.clone(); m.material.side = THREE.DoubleSide;
  return m;
}

// 날개 뒷전/윗면 패널: 경첩(hinge)을 중심으로 회전
function makePanel(s, x0, x1, chordFrac, depth, mat, top = false) {
  const span = 17.05, rootLE = -2.6, rootTE = 4.2, tipLE = 4.7, tipTE = 6.2, y0 = -1.45;
  const te = (x) => { const t = (x - 1.6) / (span - 1.6); return rootTE + (tipTE - rootTE) * t; };
  const le = (x) => { const t = (x - 1.6) / (span - 1.6); return rootLE + (tipLE - rootLE) * t; };
  const yAt = (x) => y0 + (x - 1.6) * Math.tan(5 * Math.PI / 180);
  const xm = (x0 + x1) / 2;
  const chord = te(xm) - le(xm);
  const w = chord * chordFrac;
  const pivot = new THREE.Group();
  const hinge = new THREE.Group();
  const hz = top ? le(xm) + chord * 0.55 : te(xm) - w;
  pivot.position.set(s * xm, yAt(xm) + (top ? 0.3 : 0.0), hz);
  pivot.rotation.y = -s * Math.atan((te(x1) - te(x0)) / (x1 - x0));
  const panel = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, top ? 0.04 : 0.12, w), mat);
  panel.position.z = w / 2;
  hinge.add(panel); pivot.add(hinge);
  return { pivot, hinge };
}
