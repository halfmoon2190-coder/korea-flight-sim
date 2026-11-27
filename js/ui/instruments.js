// 2D 계기: PFD(주비행표시) + 엔진·시스템 패널 + 추력레버/조종간 표시
import { AC, n1ToThrustFrac } from '../sim/a320.js';
import { DEG, KT, FT, NM, wrap180, wrap360, clamp } from '../sim/atmo.js';

const C = {
  sky: '#1f73c9', gnd: '#8a5a2b', white: '#ffffff', yellow: '#ffd23f', green: '#3ce36b', amber: '#ffb000',
  red: '#ff3b30', cyan: '#3fd4ff', magenta: '#ff4fe0', bg: '#05070a', tape: '#3a4552', panel: 'rgba(8,11,15,0.92)',
};

export class Instruments {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = true;
    this.trend = 0; this.lastIas = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.cv.width = this.w * dpr; this.cv.height = this.h * dpr;
    this.cv.style.width = this.w + 'px'; this.cv.style.height = this.h + 'px';
  }

  draw(ac, ctx2, dt) {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (!this.visible) return;
    const { view, guide, speeds } = ctx2;

    // 속도 추세 (10초 예측)
    if (this.lastIas !== null && dt > 0) {
      const a = (ac.ias - this.lastIas) / dt;
      this.trend += (a * 10 - this.trend) * Math.min(1, dt * 2);
    }
    this.lastIas = ac.ias;

    const S = Math.round(clamp(Math.min(this.h * 0.40, this.w * 0.30), 210, 360));
    const pad = 10;
    const panelW = S * 2.25 + pad * 3, panelH = S + pad * 2;
    const x0 = view === 'cockpit' ? Math.round((this.w - panelW) / 2) : pad;
    const y0 = this.h - panelH - pad;

    if (view === 'cockpit') this.drawCockpitFrame(g, y0 - 6);
    g.fillStyle = C.panel;
    roundRect(g, x0, y0, panelW, panelH, 12); g.fill();

    this.drawPFD(g, x0 + pad, y0 + pad, S, ac, guide, speeds);
    this.drawSystems(g, x0 + pad * 2 + S, y0 + pad, S * 1.25, S, ac, speeds);
  }

  drawCockpitFrame(g, top) {
    // 글레어실드 + 창틀 (조종석 느낌)
    g.fillStyle = '#1b2026';
    g.fillRect(0, top, this.w, this.h - top);
    g.fillStyle = '#262c33';
    g.beginPath(); g.moveTo(0, top); g.lineTo(this.w, top); g.lineTo(this.w, top - 14); g.quadraticCurveTo(this.w / 2, top - 34, 0, top - 14); g.closePath(); g.fill();
    g.fillStyle = '#20252b';
    const pw = Math.max(18, this.w * 0.025);
    // 왼쪽 좌석 기준이므로 중앙 기둥은 오른쪽에 보임
    const px = this.w * 0.66;
    g.beginPath(); g.moveTo(px - pw * 0.35, 0); g.lineTo(px + pw * 0.35, 0); g.lineTo(px + pw * 0.3, top - 30); g.lineTo(px - pw * 0.3, top - 30); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(pw * 2.2, 0); g.lineTo(pw * 3.5, top - 10); g.lineTo(0, top); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(this.w, 0); g.lineTo(this.w - pw * 2.2, 0); g.lineTo(this.w - pw * 3.5, top - 10); g.lineTo(this.w, top); g.closePath(); g.fill();
  }

  /* ───────── PFD ───────── */
  drawPFD(g, x, y, S, ac, guide, sp) {
    g.save();
    g.fillStyle = C.bg; g.fillRect(x, y, S, S);
    g.beginPath(); g.rect(x, y, S, S); g.clip();
    const fmaH = S * 0.1, hdgH = S * 0.1;
    const spdW = S * 0.17, altW = S * 0.15, vsW = S * 0.08;
    const attX = x + spdW + 6, attW = S - spdW - altW - vsW - 12;
    const attY = y + fmaH + 4, attH = S - fmaH - hdgH - 8;
    const cx = attX + attW / 2, cy = attY + attH / 2;
    const ppd = attH / 34;     // 피치 1°당 픽셀

    // ── 자세계 ──
    g.save();
    g.beginPath(); g.rect(attX, attY, attW, attH); g.clip();
    g.translate(cx, cy); g.rotate(-ac.bank * DEG);
    const hy = ac.pitch * ppd;
    g.fillStyle = C.sky; g.fillRect(-S, -S * 2 + hy, S * 2, S * 2);
    g.fillStyle = C.gnd; g.fillRect(-S, hy, S * 2, S * 2);
    g.strokeStyle = C.white; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-S, hy); g.lineTo(S, hy); g.stroke();
    // 피치 사다리
    g.font = `${Math.round(S * 0.038)}px monospace`; g.fillStyle = C.white; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 1.5;
    for (let p = -30; p <= 30; p += 2.5) {
      if (p === 0) continue;
      const yy = hy - p * ppd;
      if (Math.abs(yy) > attH * 0.48) continue;
      const big = p % 10 === 0, mid = p % 5 === 0;
      const hw = big ? attW * 0.22 : mid ? attW * 0.12 : attW * 0.05;
      g.beginPath(); g.moveTo(-hw, yy); g.lineTo(hw, yy); g.stroke();
      if (big) { g.fillText(Math.abs(p), -hw - 14, yy); g.fillText(Math.abs(p), hw + 14, yy); }
    }
    // 비행경로 기호 (FPV)
    const drift = wrap180(ac.track - ac.heading);   // 편류각 (격자 기준 차이는 동일)
    if (ac.tas > 20) {
      const fx = clamp(drift, -15, 15) * ppd, fy = hy - ac.fpa * ppd;
      g.strokeStyle = C.green; g.lineWidth = 2;
      g.beginPath(); g.arc(fx, fy, 6, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(fx - 18, fy); g.lineTo(fx - 6, fy); g.moveTo(fx + 6, fy); g.lineTo(fx + 18, fy); g.moveTo(fx, fy - 6); g.lineTo(fx, fy - 13); g.stroke();
    }
    g.restore();

    // 경사각 눈금
    g.save(); g.translate(cx, cy);
    const rr = attH * 0.44;
    g.strokeStyle = C.white; g.lineWidth = 1.5;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r1 = rr, r2 = rr + (Math.abs(a) % 30 === 0 ? 10 : 6);
      const t = (a - 90) * DEG;
      g.beginPath(); g.moveTo(Math.cos(t) * r1, Math.sin(t) * r1); g.lineTo(Math.cos(t) * r2, Math.sin(t) * r2); g.stroke();
    }
    g.rotate(-ac.bank * DEG);
    g.fillStyle = Math.abs(ac.bank) > 35 ? C.amber : C.yellow;
    g.beginPath(); g.moveTo(0, -rr); g.lineTo(-7, -rr + 11); g.lineTo(7, -rr + 11); g.closePath(); g.fill();
    // 옆미끄럼 지시
    const sl = clamp(ac.beta / DEG * 3, -12, 12);
    g.fillRect(-7 + sl, -rr + 13, 14, 4);
    g.restore();

    // 고정 항공기 기호
    g.fillStyle = '#000'; g.strokeStyle = C.yellow; g.lineWidth = 3;
    const ws = attW * 0.18;
    g.beginPath(); g.moveTo(cx - ws * 1.6, cy); g.lineTo(cx - ws * 0.6, cy); g.lineTo(cx - ws * 0.6, cy + 8); g.stroke();
    g.beginPath(); g.moveTo(cx + ws * 1.6, cy); g.lineTo(cx + ws * 0.6, cy); g.lineTo(cx + ws * 0.6, cy + 8); g.stroke();
    g.fillStyle = C.yellow; g.fillRect(cx - 3, cy - 3, 6, 6);

    // 조종간 위치 (지상) / 착륙 유도 편차
    if (ac.wow) {
      g.strokeStyle = C.white; g.lineWidth = 1;
      const bw = attW * 0.18;
      g.strokeRect(cx - bw, cy - bw, bw * 2, bw * 2);
      g.strokeStyle = C.white; g.lineWidth = 2.5;
      const sx = cx + ac.ctl.roll * bw, sy = cy + ac.ctl.pitch * bw;   // 조종간 위치 (당김 = 아래)
      g.beginPath(); g.moveTo(sx - 7, sy); g.lineTo(sx + 7, sy); g.moveTo(sx, sy - 7); g.lineTo(sx, sy + 7); g.stroke();
    }
    if (guide && guide.active) this.drawGuide(g, attX, attY, attW, attH, cx, cy, guide);

    // 전파고도
    if (ac.raFt < 2500) {
      g.font = `bold ${Math.round(S * 0.06)}px monospace`;
      g.fillStyle = ac.raFt < 400 ? C.amber : C.green;
      g.textAlign = 'center';
      const ra = Math.max(0, ac.raFt);
      const raTxt = ra < 50 ? Math.round(ra) : ra < 400 ? Math.round(ra / 5) * 5 : Math.round(ra / 10) * 10;
      g.fillText(raTxt, cx, attY + attH - S * 0.05);
    }

    // ── 속도 테이프 ──
    this.drawSpeedTape(g, x + 2, attY, spdW - 4, attH, ac, sp);
    // ── 고도 테이프 ──
    this.drawAltTape(g, attX + attW + 6, attY, altW, attH, ac);
    // ── 승강계 ──
    this.drawVS(g, attX + attW + 8 + altW, attY + attH * 0.1, vsW - 4, attH * 0.8, ac);
    // ── 방위 테이프 ──
    this.drawHeading(g, attX, y + S - hdgH, attW, hdgH - 4, ac);
    // ── FMA ──
    this.drawFMA(g, x, y, S, fmaH, ac);
    g.restore();
    g.strokeStyle = '#2a3440'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
  }

  drawGuide(g, ax, ay, aw, ah, cx, cy, gd) {
    // 활주로 연장선(LOC) · 3° 활공경로(G/S) 편차 다이아몬드: 1점 = 0.8° / 0.35°
    g.save();
    g.fillStyle = C.white; g.strokeStyle = C.white; g.lineWidth = 1.5;
    const dotL = aw * 0.09, dotG = ah * 0.09;
    for (let i = -2; i <= 2; i++) {
      if (!i) continue;
      g.beginPath(); g.arc(cx + i * dotL, ay + ah - 10, 3, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(ax + aw - 10, cy + i * dotG, 3, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = C.magenta;
    const lx = cx + clamp(gd.locDev / 0.8, -2.4, 2.4) * dotL;
    diamond(g, lx, ay + ah - 10, 7, 5);
    if (gd.gsValid) {
      const gyv = cy + clamp(gd.gsDev / 0.35, -2.4, 2.4) * dotG;   // 경로보다 높으면 아래에 표시
      diamond(g, ax + aw - 10, gyv, 5, 7);
    }
    g.font = `${Math.round(ah * 0.045)}px monospace`; g.fillStyle = C.magenta; g.textAlign = 'left';
    g.fillText(`${gd.name} ${gd.distNm.toFixed(1)}NM`, ax + 6, ay + 14);
    g.restore();
  }

  drawSpeedTape(g, x, y, w, h, ac, sp) {
    g.save();
    g.fillStyle = C.tape; g.fillRect(x, y, w, h);
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const cy = y + h / 2, ppk = h / 80;
    const ias = Math.max(30, ac.ias);
    g.strokeStyle = C.white; g.fillStyle = C.white; g.lineWidth = 1.5;
    g.font = `${Math.round(w * 0.3)}px monospace`; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let v = Math.floor((ias - 45) / 10) * 10; v <= ias + 45; v += 10) {
      if (v < 30) continue;
      const yy = cy - (v - ias) * ppk;
      g.beginPath(); g.moveTo(x + w - 10, yy); g.lineTo(x + w, yy); g.stroke();
      if (v % 20 === 0) g.fillText(v, x + w - 13, yy);
    }
    // VMAX (적/흑 줄무늬)
    const vmax = Math.min(AC.vmo, ac.vfe, ac.gearPos > 0.02 ? AC.vle : 999);
    const ymax = cy - (vmax - ias) * ppk;
    if (ymax > y) {
      for (let yy = ymax; yy > y - 10; yy -= 10) {
        g.fillStyle = C.red; g.fillRect(x + w - 7, yy - 5, 7, 5);
        g.fillStyle = '#000'; g.fillRect(x + w - 7, yy - 10, 7, 5);
      }
    }
    // VLS / 받음각 보호 (호박색 / 적색)
    if (!ac.wow && sp) {
      const vls = sp.vls(ac.ctl.flapLever, ac.is1F);
      const vprot = vls / 1.23 * 1.08, vmaxA = vls / 1.23 * 1.02;
      const yv = cy - (vls - ias) * ppk, yp = cy - (vprot - ias) * ppk, ym = cy - (vmaxA - ias) * ppk;
      g.fillStyle = C.amber; g.fillRect(x + w - 4, Math.min(yv, y + h), 3, Math.max(0, yp - yv));
      g.fillStyle = '#000'; g.fillRect(x + w - 7, yp, 7, Math.max(0, ym - yp));
      g.fillStyle = C.amber;
      for (let yy = yp; yy < ym; yy += 8) g.fillRect(x + w - 7, yy, 7, 4);
      g.fillStyle = C.red; g.fillRect(x + w - 7, ym, 7, y + h - ym);
    }
    // 이륙 속도 표시 (지상)
    if (ac.wow && sp) {
      g.font = `bold ${Math.round(w * 0.26)}px monospace`; g.textAlign = 'left';
      for (const [lab, v, col] of [['1', sp.v1, C.cyan], ['R', sp.vr, C.cyan], ['2', sp.v2, C.magenta]]) {
        const yy = cy - (v - ias) * ppk;
        if (yy < y || yy > y + h) continue;
        g.fillStyle = col; g.fillText(lab, x + 2, yy);
      }
    }
    // 속도 추세 화살표
    if (Math.abs(this.trend) > 2 && ac.ias > 40) {
      const ty = cy - this.trend * ppk;
      g.strokeStyle = C.yellow; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + w - 14, cy); g.lineTo(x + w - 14, ty); g.stroke();
      const s = Math.sign(this.trend);
      g.beginPath(); g.moveTo(x + w - 19, ty + s * 6); g.lineTo(x + w - 14, ty); g.lineTo(x + w - 9, ty + s * 6); g.stroke();
    }
    g.restore();
    // 현재 속도 기준선
    g.strokeStyle = C.yellow; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w + 6, y + h / 2); g.stroke();
    // 마하
    g.font = `${Math.round(w * 0.24)}px monospace`; g.fillStyle = C.green; g.textAlign = 'center';
    if (ac.mach > 0.45) g.fillText('.' + Math.round(ac.mach * 1000).toString().padStart(3, '0'), x + w / 2, y + h + 10);
    g.fillStyle = C.white;
    g.font = `bold ${Math.round(w * 0.3)}px monospace`;
    g.fillText(Math.round(ac.ias), x + w / 2, y - 9);
  }

  drawAltTape(g, x, y, w, h, ac) {
    g.save();
    g.fillStyle = C.tape; g.fillRect(x, y, w, h);
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const cy = y + h / 2, ppf = h / 1000, alt = ac.altFt;
    g.strokeStyle = C.white; g.fillStyle = C.white; g.lineWidth = 1.5;
    g.font = `${Math.round(w * 0.27)}px monospace`; g.textAlign = 'left'; g.textBaseline = 'middle';
    for (let a = Math.floor((alt - 600) / 100) * 100; a <= alt + 600; a += 100) {
      const yy = cy - (a - alt) * ppf;
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + (a % 500 === 0 ? 10 : 6), yy); g.stroke();
      if (a % 500 === 0) g.fillText(String(Math.round(a / 100)).padStart(3, '0'), x + 12, yy);
    }
    // 지면 (적색 띠)
    const groundAlt = alt - ac.raFt;
    const yg = cy - (groundAlt - alt) * ppf;
    if (yg < y + h) { g.fillStyle = 'rgba(255,59,48,0.55)'; g.fillRect(x, yg, w, y + h - yg); }
    g.restore();
    // 현재 고도 상자
    g.fillStyle = '#000'; g.strokeStyle = C.yellow; g.lineWidth = 2;
    const bh = h * 0.1;
    g.fillRect(x - 2, y + h / 2 - bh / 2, w + 4, bh); g.strokeRect(x - 2, y + h / 2 - bh / 2, w + 4, bh);
    g.fillStyle = C.green; g.font = `bold ${Math.round(w * 0.3)}px monospace`; g.textAlign = 'center';
    g.fillText(Math.round(ac.altFt / 10) * 10, x + w / 2, y + h / 2 + 1);
    g.font = `${Math.round(w * 0.22)}px monospace`; g.fillStyle = C.cyan;
    g.fillText('ft', x + w / 2, y + h + 10);
  }

  drawVS(g, x, y, w, h, ac) {
    g.fillStyle = C.tape; g.fillRect(x, y, w, h);
    const fpm = ac.vs / FT * 60;
    const cy = y + h / 2;
    const map = (v) => Math.sign(v) * Math.min(1, Math.sqrt(Math.abs(v) / 6000)) * (h / 2 - 4);
    g.strokeStyle = C.white; g.lineWidth = 1;
    for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) {
      const yy = cy - map(v);
      g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 5, yy); g.stroke();
    }
    const yy = cy - map(fpm);
    g.strokeStyle = Math.abs(fpm) > 6000 ? C.amber : C.green; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x + w + 6, cy); g.lineTo(x + 4, yy); g.stroke();
    if (Math.abs(fpm) > 200) {
      g.fillStyle = C.green; g.font = `${Math.round(w * 0.5)}px monospace`; g.textAlign = 'center';
      g.fillText(Math.round(Math.abs(fpm) / 100), x + w / 2, fpm > 0 ? y - 8 : y + h + 9);
    }
  }

  drawHeading(g, x, y, w, h, ac) {
    g.save();
    g.fillStyle = C.tape; g.fillRect(x, y, w, h);
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const cx = x + w / 2, ppd = w / 50;
    g.strokeStyle = C.white; g.fillStyle = C.white; g.lineWidth = 1.5;
    g.font = `${Math.round(h * 0.42)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const hd = ac.dispHeading ?? ac.heading;
    for (let d = Math.floor((hd - 30) / 5) * 5; d <= hd + 30; d += 5) {
      const xx = cx + wrap180(d - hd) * ppd;
      g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + (d % 10 === 0 ? 9 : 5)); g.stroke();
      if (d % 10 === 0) g.fillText(String(wrap360(d) / 10 | 0).padStart(2, '0'), xx, y + h * 0.65);
    }
    // 항적(초록 다이아몬드)
    const tx = cx + clamp(wrap180((ac.dispTrack ?? ac.track) - hd), -24, 24) * ppd;
    g.fillStyle = C.green; diamond(g, tx, y + 5, 4, 5);
    g.restore();
    g.strokeStyle = C.yellow; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, y - 6); g.lineTo(cx, y + 10); g.stroke();
  }

  drawFMA(g, x, y, S, h, ac) {
    g.fillStyle = '#000'; g.fillRect(x, y, S, h);
    g.strokeStyle = '#555'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + S * i / 4, y + 3); g.lineTo(x + S * i / 4, y + h - 3); g.stroke(); }
    g.font = `${Math.round(h * 0.36)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const L = ac.ctl.lever;
    let thr = 'MAN THR';
    if (ac.ctl.rev) thr = 'REV';
    else if (L > 0.99) thr = 'MAN TOGA';
    else if (Math.abs(L - AC.detents.MCT) < 0.01) thr = ac.wow ? 'MAN FLX' : 'MAN MCT';
    else if (Math.abs(L - AC.detents.CL) < 0.01) thr = 'THR CLB';
    else if (L < 0.01) thr = 'THR IDLE';
    g.fillStyle = thr.startsWith('MAN') ? C.white : C.green;
    g.fillText(thr, x + S / 8, y + h / 2);
    const law = { GROUND: 'GND', NORMAL: 'NORMAL', FLARE: 'FLARE' }[ac.law];
    g.fillStyle = ac.law === 'FLARE' ? C.green : C.white;
    g.fillText(law + ' LAW', x + S * 3 / 8, y + h / 2);
    g.fillStyle = C.cyan;
    g.fillText(`FLAP ${ac.flapLabel}`, x + S * 5 / 8, y + h / 2);
    g.fillStyle = ac.aProtActive ? C.amber : C.white;
    g.fillText(ac.aProtActive ? 'α PROT' : `GS ${Math.round(ac.gs / KT)}`, x + S * 7 / 8, y + h / 2);
  }

  /* ───────── 엔진 · 시스템 ───────── */
  drawSystems(g, x, y, W, H, ac, sp) {
    g.fillStyle = C.bg; g.fillRect(x, y, W, H);
    g.strokeStyle = '#2a3440'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
    const fs = Math.round(H * 0.052);
    g.textBaseline = 'middle';
    // N1 게이지 2개
    const gr = H * 0.17;
    for (let i = 0; i < 2; i++) {
      const gx = x + W * (0.2 + i * 0.32), gy = y + H * 0.23;
      this.drawN1(g, gx, gy, gr, ac, fs);
    }
    // 추력 레버 표시
    this.drawLever(g, x + W * 0.86, y + H * 0.06, W * 0.1, H * 0.48, ac, fs);

    // 연료 흐름
    g.font = `${fs}px monospace`; g.textAlign = 'center'; g.fillStyle = C.white;
    g.fillText('FF kg/h', x + W * 0.36, y + H * 0.47);
    g.fillStyle = C.green;
    const ffph = Math.round(ac.fuelFlow / 2 * 3600 / 10) * 10;
    g.fillText(ffph, x + W * 0.2, y + H * 0.47); g.fillText(ffph, x + W * 0.52, y + H * 0.47);

    // 구분선
    g.strokeStyle = '#2a3440'; g.beginPath(); g.moveTo(x + 6, y + H * 0.55); g.lineTo(x + W - 6, y + H * 0.55); g.stroke();

    // 플랩
    const fy = y + H * 0.64;
    g.textAlign = 'left'; g.fillStyle = C.white; g.font = `${fs}px monospace`;
    g.fillText('FLAP', x + 10, fy);
    const transit = Math.abs(ac.flapPos - ac.ctl.flapLever) > 0.01;
    g.fillStyle = transit ? C.cyan : C.green;
    g.font = `bold ${Math.round(fs * 1.25)}px monospace`;
    g.fillText(ac.flapLabel, x + 10 + fs * 3, fy);
    // 플랩 위치 막대
    const bx = x + 10, bw = W * 0.4, by = fy + fs * 0.9;
    g.fillStyle = '#222'; g.fillRect(bx, by, bw, 5);
    g.fillStyle = transit ? C.cyan : C.green; g.fillRect(bx, by, bw * ac.flapPos / 4, 5);
    for (let i = 0; i <= 4; i++) { g.fillStyle = C.white; g.fillRect(bx + bw * i / 4 - 1, by - 3, 2, 11); }

    // 기어
    const gx0 = x + W * 0.55, gy0 = y + H * 0.62;
    g.font = `${fs}px monospace`; g.fillStyle = C.white; g.textAlign = 'left';
    g.fillText('GEAR', gx0, gy0);
    const gtxt = ac.gearPos > 0.98 ? '▼ ▼ ▼' : ac.gearPos < 0.02 ? 'UP' : '▽ ▽ ▽';
    g.fillStyle = ac.gearPos > 0.98 ? C.green : ac.gearPos < 0.02 ? C.white : C.red;
    g.font = `bold ${Math.round(fs * 1.1)}px monospace`;
    g.fillText(gtxt, gx0 + fs * 3.2, gy0);

    // 상태 줄
    const items = [];
    if (ac.ctl.parking) items.push(['PARK BRK', C.amber]);
    if (ac.ctl.brake > 0) items.push(['BRAKE', C.green]);
    if (ac.ctl.sbArmed) items.push(['GND SPLR ARM', C.cyan]);
    if (ac.sbPos > 0.02) items.push([`SPD BRK ${Math.round(ac.sbPos * 100)}%`, ac.ctl.flapLever === 4 ? C.amber : C.green]);
    if (ac.gsPos > 0.1) items.push(['GND SPLR', C.green]);
    if (ac.ctl.rev) items.push([`REV ${Math.round(ac.ctl.revAmt * 100)}%`, C.green]);
    if (ac.tailStrike) items.push(['TAIL STRIKE', C.red]);
    g.font = `${Math.round(fs * 0.92)}px monospace`; g.textAlign = 'left';
    let ix = x + 10, iy = y + H * 0.78;
    for (const [t, col] of items) {
      const tw = g.measureText(t).width + 12;
      if (ix + tw > x + W - 6) { ix = x + 10; iy += fs * 1.35; }
      g.fillStyle = col; g.fillText(t, ix, iy);
      ix += tw;
    }
    // 하단 정보
    g.font = `${Math.round(fs * 0.9)}px monospace`;
    g.fillStyle = C.white; g.textAlign = 'left';
    const by2 = y + H - fs * 0.9;
    g.fillText(`GW ${(ac.mass / 1000).toFixed(1)}t`, x + 10, by2);
    g.fillText(`FOB ${Math.round(ac.fuel)}kg`, x + W * 0.33, by2);
    g.fillText(`THS ${(ac.ths / DEG).toFixed(1)}°`, x + W * 0.7, by2);
  }

  drawN1(g, cx, cy, r, ac, fs) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (v) => a0 + (a1 - a0) * clamp(v / 110, 0, 1);
    g.lineWidth = 3; g.strokeStyle = '#555';
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    g.strokeStyle = C.red; g.beginPath(); g.arc(cx, cy, r, ang(101), ang(110)); g.stroke();
    g.strokeStyle = C.white; g.lineWidth = 1.5;
    for (let v = 0; v <= 100; v += 10) {
      const a = ang(v); g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * (r - (v % 50 ? 4 : 8)), cy + Math.sin(a) * (r - (v % 50 ? 4 : 8))); g.stroke();
    }
    // 바늘
    const a = ang(ac.n1);
    g.strokeStyle = C.green; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95); g.stroke();
    // 레버 목표 (청록 원)
    const tgt = ac.ctl.rev ? 21 + ac.ctl.revAmt * 51 : (ac.ctl.lever === 0 ? (ac.wow ? 21 : 27) : null);
    let tN1 = tgt;
    if (tN1 === null) {
      const tab = AC.leverTable.map(([x, y]) => [x, y === null ? (ac.wow ? 21 : 27) : y]);
      for (let i = 1; i < tab.length; i++) if (ac.ctl.lever <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; tN1 = y0 + (y1 - y0) * (ac.ctl.lever - x0) / (x1 - x0); break; }
    }
    const ta = ang(tN1);
    g.strokeStyle = C.cyan; g.lineWidth = 2;
    g.beginPath(); g.arc(cx + Math.cos(ta) * (r + 6), cy + Math.sin(ta) * (r + 6), 3.5, 0, Math.PI * 2); g.stroke();
    g.fillStyle = C.green; g.font = `bold ${Math.round(fs * 1.15)}px monospace`; g.textAlign = 'center';
    g.fillText(ac.n1.toFixed(1), cx + r * 0.25, cy + r * 0.55);
    g.fillStyle = C.white; g.font = `${Math.round(fs * 0.8)}px monospace`;
    g.fillText(ac.ctl.rev ? 'REV' : 'N1 %', cx - r * 0.1, cy - r * 0.3);
  }

  drawLever(g, x, y, w, h, ac, fs) {
    g.fillStyle = '#111'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.font = `${Math.round(fs * 0.7)}px monospace`; g.textAlign = 'right';
    const yy = (L) => y + h - 8 - L * (h - 16);
    for (const [lab, L] of [['TOGA', 1], ['MCT', AC.detents.MCT], ['CL', AC.detents.CL], ['IDLE', 0]]) {
      g.fillStyle = '#9aa'; g.fillText(lab, x - 3, yy(L));
      g.fillStyle = '#666'; g.fillRect(x + 2, yy(L) - 1, w - 4, 2);
    }
    const L = ac.ctl.rev ? 0 : ac.ctl.lever;
    g.fillStyle = ac.ctl.rev ? C.amber : C.cyan;
    g.fillRect(x + 2, yy(L) - 5, w - 4, 10);
  }
}

function diamond(g, x, y, rx, ry) {
  g.beginPath(); g.moveTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.lineTo(x - rx, y); g.closePath(); g.fill();
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
