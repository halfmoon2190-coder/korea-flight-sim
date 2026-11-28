// 3D 조종석 (A320급 배치를 단순화한 독자 모델)
// 좌표: 기체 좌표계 (x 오른쪽, y 위, z 뒤 / 기수 = -z). 조종사 눈: AC.cockpitEye
import * as THREE from '../../vendor/three.module.min.js';
import { AC } from '../sim/a320.js';
import { DEG } from '../sim/atmo.js';

const COL = { panel: 0x4a535e, dark: 0x30363d, black: 0x16191d, glare: 0x22262b, metal: 0x8a9096, seat: 0x3b3f46, floor: 0x2c3036 };

export class Cockpit {
  constructor(quality) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.q = quality;
    const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
    this.m = { panel: lam(COL.panel), dark: lam(COL.dark), black: lam(COL.black), glare: lam(COL.glare), metal: lam(COL.metal), seat: lam(COL.seat), floor: lam(COL.floor) };
    this.disp = {};
    this.parts = {};
    this.buildShell();
    this.buildPanel();
    this.buildPedestal();
    this.buildSidestick();
    this.buildOverhead();
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    // 실내 조명 (야간 은은한 조명)
    this.flood = new THREE.PointLight(0xffe2b8, 0, 3, 2);
    this.flood.position.set(-0.2, 2.0, -14.5);
    this.root.add(this.flood);
    this.t = 0;
  }

  box(w, h, d, mat, x, y, z, parent = this.root, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parent.add(m); return m;
  }

  /* 창틀 · 벽 · 바닥 · 좌석 */
  buildShell() {
    const { dark, black, floor, seat, panel } = this.m;
    this.box(2.4, 0.04, 2.6, floor, 0, 0.35, -14.4);                                    // 바닥
    // 앞유리 기둥 (위로 갈수록 뒤로 기움)
    const post = (x, w) => this.box(w, 1.05, 0.06, black, x, 1.8, -15.62, this.root, -0.62, 0, 0);
    post(0, 0.055); post(-1.08, 0.07); post(1.08, 0.07);
    this.box(2.3, 0.07, 0.12, black, 0, 2.24, -15.3);                                   // 윗 창틀
    // 옆벽: 창문 아래 · 위, 창문 기둥
    for (const s of [-1, 1]) {
      this.box(0.06, 0.85, 2.4, panel, s * 1.18, 0.78, -14.4);                          // 창 아래 벽
      this.box(0.06, 0.28, 2.4, dark, s * 1.16, 2.18, -14.4);                           // 창 위 벽
      this.box(0.08, 0.85, 0.08, black, s * 1.17, 1.62, -14.0);                         // 옆창 뒤 기둥
      this.box(0.06, 0.85, 0.06, black, s * 1.16, 1.62, -15.45, this.root, 0, 0, 0);    // 옆창 앞 기둥
      this.box(0.07, 0.06, 1.3, black, s * 1.16, 1.22, -14.6);                          // 창턱
    }
    // 부기장 좌석
    const sg = new THREE.Group(); sg.position.set(0.55, 0.35, -14.0); this.root.add(sg);
    this.box(0.5, 0.12, 0.5, seat, 0, 0.42, 0, sg);
    this.box(0.5, 0.75, 0.1, seat, 0, 0.85, 0.24, sg, 0.12);
    this.box(0.26, 0.18, 0.08, seat, 0, 1.33, 0.3, sg, 0.12);
    // 기장 좌석 (뒤쪽만 살짝 보임)
    const cg = sg.clone(); cg.position.set(-0.55, 0.35, -14.0); this.root.add(cg);
  }

  /* 주 계기판 · 글레어실드 · FCU · 화면 6개 */
  buildPanel() {
    const { panel, glare, black, dark } = this.m;
    const pg = new THREE.Group();
    pg.position.set(0, 0.93, -15.52); pg.rotation.x = -0.22;
    this.root.add(pg);
    this.box(2.3, 0.7, 0.05, panel, 0, -0.04, -0.02, pg);
    // 화면
    const mk = (key, w, h, cw, ch) => {
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      this.disp[key] = { c, g: c.getContext('2d'), t, w: cw, h: ch };
      return new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    };
    const res = this.q === 'low' ? 384 : 512;
    const pfdM = mk('pfd', 0.21, 0.21, res, res), ndM = mk('nd', 0.21, 0.21, res, res), ewdM = mk('ewd', 0.21, 0.21, res, res), sdM = mk('sd', 0.21, 0.21, res, res);
    const scr = (mat, x, y) => {
      this.box(0.27, 0.27, 0.03, black, x, y, 0.005, pg);                              // 베젤
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.235), mat);
      m.position.set(x, y, 0.022); pg.add(m); return m;
    };
    scr(pfdM, -0.88, 0.06); scr(ndM, -0.58, 0.06);
    scr(ewdM, 0, 0.13); scr(sdM, 0, -0.17);
    scr(ndM, 0.58, 0.06); scr(pfdM, 0.88, 0.06);
    // 기어 레버 · 표시등 (오른쪽 화면 사이)
    const gl = new THREE.Group(); gl.position.set(0.3, -0.13, 0.03); pg.add(gl);
    this.box(0.07, 0.14, 0.02, dark, 0, 0, -0.005, gl);
    const leverArm = new THREE.Group(); gl.add(leverArm);
    this.box(0.012, 0.09, 0.012, this.m.metal, 0, 0.045, 0.015, leverArm);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.09, 0.02); leverArm.add(wheel);
    this.parts.gearLever = leverArm;
    this.parts.gearLights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.016), new THREE.MeshBasicMaterial({ color: 0x113311, toneMapped: false }));
      l.position.set(0.075 + (i - 1) * 0.026, 0.035 + (i === 1 ? 0.02 : 0), 0.01); gl.add(l);
      this.parts.gearLights.push(l);
    }
    // 마스터 경고 · 주의등 (양쪽)
    this.parts.mw = []; this.parts.mc = [];
    for (const x of [-1.08, 1.08]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0x330000, toneMapped: false }));
      w.position.set(x, 0.22, 0.02); pg.add(w); this.parts.mw.push(w);
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshBasicMaterial({ color: 0x332200, toneMapped: false }));
      c.position.set(x, 0.18, 0.02); pg.add(c); this.parts.mc.push(c);
    }
    // 글레어실드 + FCU
    this.box(2.3, 0.06, 0.42, glare, 0, 1.30, -15.72, this.root, 0.05);
    this.box(2.3, 0.1, 0.05, glare, 0, 1.25, -15.5, this.root, -0.35);
    const fcuM = mk('fcu', 0.7, 0.087, 1024, 128);
    const fcu = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.087), fcuM);
    fcu.position.set(0, 1.25, -15.47); fcu.rotation.x = -0.35;
    this.root.add(fcu);
  }

  /* 페데스탈: 추력 레버 · 플랩 · 스피드브레이크 · 주기 브레이크 */
  buildPedestal() {
    const { dark, panel, metal, black } = this.m;
    const ped = new THREE.Group(); ped.position.set(0, 0.6, -14.85); this.root.add(ped);
    this.box(0.52, 0.5, 1.15, dark, 0, -0.1, 0, ped);
    this.box(0.5, 0.03, 1.12, panel, 0, 0.16, 0, ped, 0.08);
    const handle = (x, col) => {
      const g = new THREE.Group(); g.position.set(x, 0.17, -0.12); ped.add(g);
      this.box(0.022, 0.2, 0.022, metal, 0, 0.1, 0, g);
      this.box(0.06, 0.035, 0.05, new THREE.MeshLambertMaterial({ color: col }), 0, 0.2, 0, g);
      return g;
    };
    this.parts.thr = [handle(-0.05, 0x2a2a2a), handle(0.05, 0x2a2a2a)];
    // 추력 레버 멈춤쇠 표시 판
    this.box(0.16, 0.012, 0.3, black, 0, 0.175, -0.12, ped, 0.08);
    this.parts.flap = handle(0.19, 0xe8e8e8);
    this.parts.spd = handle(-0.19, 0x3a3a3a);
    this.parts.flap.position.z = 0.05; this.parts.spd.position.z = 0.05;
    const pb = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), new THREE.MeshLambertMaterial({ color: 0xc8a020 }));
    pb.position.set(0, 0.2, 0.32); ped.add(pb); this.parts.park = pb;
    // 무전기 · 기타 패널 (질감용 작은 상자)
    for (let i = 0; i < 6; i++) this.box(0.2, 0.02, 0.07, black, (i % 2 ? 0.11 : -0.11), 0.19, 0.18 + Math.floor(i / 2) * 0.1, ped, 0.08);
  }

  buildSidestick() {
    const { dark, black } = this.m;
    this.box(0.3, 0.14, 0.9, dark, -0.98, 0.68, -14.55);                                // 왼쪽 콘솔
    const sg = new THREE.Group(); sg.position.set(-1.0, 0.76, -14.62); this.root.add(sg);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.02, 16), black); base.position.y = 0.0; sg.add(base);
    const stick = new THREE.Group(); sg.add(stick);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.12, 10), black); shaft.position.y = 0.06; stick.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.1, 12), new THREE.MeshLambertMaterial({ color: 0x1e1e1e }));
    grip.position.set(0, 0.15, 0); grip.rotation.x = 0.15; stick.add(grip);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0xcc2222 }));
    btn.position.set(0.012, 0.2, -0.008); stick.add(btn);
    this.parts.stick = stick;
    this.box(0.3, 0.14, 0.9, dark, 0.98, 0.68, -14.55);                                 // 오른쪽 콘솔
  }

  /* 오버헤드 패널 (버튼 질감) */
  buildOverhead() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#48515c'; x.fillRect(0, 0, 512, 512);
    x.strokeStyle = '#2f353c'; x.lineWidth = 3;
    for (let i = 0; i < 6; i++) { x.strokeRect(8 + i * 84, 8, 78, 496); }
    for (let i = 0; i < 160; i++) {
      const bx = 18 + (i % 6) * 84 + ((i * 37) % 3) * 20, by = 24 + Math.floor(i / 6) * 18.5;
      x.fillStyle = '#1b1e22'; x.fillRect(bx, by, 16, 11);
      if (i % 7 === 0) { x.fillStyle = '#3fd4ff'; x.fillRect(bx + 2, by + 2, 12, 3); }
      if (i % 11 === 0) { x.fillStyle = '#ffb000'; x.fillRect(bx + 2, by + 6, 12, 3); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 1.3), [this.m.dark, this.m.dark, this.m.dark, new THREE.MeshLambertMaterial({ map: t }), this.m.dark, this.m.dark]);
    m.position.set(0, 2.33, -14.35); m.rotation.x = -0.3;
    this.root.add(m);
    this.box(2.3, 0.04, 2.3, this.m.dark, 0, 2.42, -14.3);                              // 천장
  }

  /* 매 프레임 */
  update(ac, ap, inst, ctx, warnings, dt, night) {
    if (!this.root.visible) return;
    const p = this.parts, c = ac.ctl;
    // 사이드스틱 (당김 = 뒤로)
    p.stick.rotation.x = c.pitch * 16 * DEG;
    p.stick.rotation.z = -c.roll * 16 * DEG;
    // 추력 레버: IDLE → TOGA = 0.38 → -0.42 rad, 역추력은 더 뒤로
    const lv = c.rev ? -0.15 - c.revAmt * 0.3 : c.lever;
    for (const h of p.thr) h.rotation.x = 0.38 - lv * 0.8;
    p.flap.rotation.x = -0.35 + c.flapLever * 0.175;
    p.spd.rotation.x = -0.3 + (c.sbLever || 0) * 0.5 + (c.sbArmed ? -0.05 : 0);
    p.park.rotation.z = c.parking ? Math.PI / 2 : 0;
    p.gearLever.rotation.x = c.gearDown ? 0.5 : -0.3;
    p.gearLever.position.y = c.gearDown ? -0.035 : 0.02;
    const gcol = ac.gearPos > 0.98 ? 0x30ff50 : ac.gearPos > 0.02 ? 0xff3020 : 0x113311;
    for (const l of p.gearLights) l.material.color.setHex(gcol);
    const red = warnings.some(w => w.level === 'red'), amber = warnings.some(w => w.level === 'amber');
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    for (const w of p.mw) w.material.color.setHex(red && blink ? 0xff2020 : 0x330000);
    for (const w of p.mc) w.material.color.setHex(amber ? 0xffb000 : 0x332200);
    this.flood.intensity = night ? 0.6 : 0;
    // 화면 갱신 (약 30Hz)
    this.t += dt;
    if (this.t < 1 / 30) return;
    this.t = 0;
    const d = this.disp;
    d.pfd.g.setTransform(1, 0, 0, 1, 0, 0); d.pfd.g.clearRect(0, 0, d.pfd.w, d.pfd.h);
    inst.drawPFD(d.pfd.g, 0, 0, d.pfd.w, ac, ctx.guide, ctx.speeds); d.pfd.t.needsUpdate = true;
    if (ctx.nd) { inst.drawNDPanel(d.nd.g, 0, 0, d.nd.w, ac, ctx.nd); d.nd.t.needsUpdate = true; }
    d.ewd.g.setTransform(1, 0, 0, 1, 0, 0);
    inst.drawSystems(d.ewd.g, 0, 0, d.ewd.w, d.ewd.h, ac, ctx.speeds); d.ewd.t.needsUpdate = true;
    drawSD(d.sd.g, d.sd.w, ac, warnings); d.sd.t.needsUpdate = true;
    drawFCU(d.fcu.g, d.fcu.w, d.fcu.h, ap); d.fcu.t.needsUpdate = true;
  }
}

/* 하부 ECAM: 바퀴 · 브레이크 · 연료 · 경고 */
function drawSD(g, S, ac, warnings) {
  g.fillStyle = '#05070a'; g.fillRect(0, 0, S, S);
  g.font = `${S * 0.05}px monospace`; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#fff'; g.fillText('WHEEL', S / 2, S * 0.07);
  const gx = [S * 0.5, S * 0.25, S * 0.75], gy = [S * 0.22, S * 0.4, S * 0.4], names = ['NOSE', 'L', 'R'];
  for (let i = 0; i < 3; i++) {
    const ok = ac.gearPos > 0.98, tr = ac.gearPos > 0.02 && !ok;
    g.fillStyle = ok ? '#3ce36b' : tr ? '#ff3b30' : '#555';
    g.beginPath(); g.moveTo(gx[i] - S * 0.05, gy[i] - S * 0.03); g.lineTo(gx[i] + S * 0.05, gy[i] - S * 0.03); g.lineTo(gx[i], gy[i] + S * 0.04); g.closePath(); g.fill();
    g.fillStyle = '#9aa'; g.font = `${S * 0.035}px monospace`; g.fillText(names[i], gx[i], gy[i] + S * 0.08);
  }
  g.font = `${S * 0.045}px monospace`;
  const ab = ['', 'LO', 'MED', 'MAX'][ac.ctl.autobrake];
  g.fillStyle = ac.abActive ? '#3ce36b' : '#3fd4ff'; if (ab) g.fillText(`AUTO BRK ${ab}`, S / 2, S * 0.58);
  if (ac.ctl.parking) { g.fillStyle = '#ffb000'; g.fillText('PARK BRK ON', S / 2, S * 0.64); }
  g.fillStyle = '#fff'; g.textAlign = 'left';
  g.fillText(`FOB ${Math.round(ac.fuel)} KG`, S * 0.06, S * 0.74);
  g.fillText(`GW  ${(ac.mass / 1000).toFixed(1)} T`, S * 0.06, S * 0.8);
  g.font = `${S * 0.04}px monospace`;
  warnings.slice(0, 3).forEach((w, i) => { g.fillStyle = w.level === 'red' ? '#ff3b30' : '#ffb000'; g.fillText(w.id, S * 0.06, S * 0.88 + i * S * 0.045); });
}

/* FCU 표시창 */
function drawFCU(g, W, H, ap) {
  g.fillStyle = '#2b3035'; g.fillRect(0, 0, W, H);
  if (!ap) return;
  const f = ap.fcu;
  const latMan = ['NAV', 'LOC*', 'LOC', 'LAND', 'ROLL OUT'].includes(ap.lat);
  const items = [
    ['SPD', f.spdMan ? '---•' : String(f.spd)], ['HDG', latMan ? '---•' : String(f.hdg).padStart(3, '0')],
    ['ALT', String(f.alt).padStart(5, '0')], ['V/S', ap.vert === 'V/S' ? (f.vs >= 0 ? '+' : '-') + String(Math.abs(f.vs)).padStart(4, '0') : '-----'],
  ];
  g.textBaseline = 'middle'; g.textAlign = 'center';
  items.forEach(([l, v], i) => {
    const x = W * (0.09 + i * 0.16);
    g.fillStyle = '#000'; g.fillRect(x - 70, H * 0.38, 140, H * 0.5);
    g.fillStyle = '#ffb000'; g.font = `bold ${H * 0.4}px monospace`; g.fillText(v, x, H * 0.64);
    g.fillStyle = '#ccd'; g.font = `${H * 0.2}px monospace`; g.fillText(l, x, H * 0.2);
  });
  const btn = [['AP1', ap.ap], ['A/THR', ap.athr], ['LOC', ap.armed.loc || (ap.lat || '').startsWith('LOC')], ['APPR', ap.armed.gs || ['G/S', 'LAND'].includes(ap.vert)]];
  btn.forEach(([l, on], i) => {
    const x = W * (0.71 + i * 0.075);
    g.fillStyle = '#1b1e22'; g.fillRect(x - 32, H * 0.25, 64, H * 0.55);
    g.fillStyle = on ? '#3ce36b' : '#3a4048'; g.fillRect(x - 22, H * 0.3, 44, 6);
    g.fillStyle = '#dde'; g.font = `${H * 0.2}px monospace`; g.fillText(l, x, H * 0.6);
  });
}
