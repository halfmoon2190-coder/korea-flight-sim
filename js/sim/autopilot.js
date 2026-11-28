// 자동비행: 오토파일럿(AP) · 오토스로틀(A/THR) · 비행지시기(FD)
// AP는 실제 A320처럼 전자식 조종(정상 법칙)에 조종간 명령을 넣는 방식으로 동작
import { AC, flapParams, leverToN1 } from './a320.js';
import { G, KT, FT, NM, DEG, isa, clamp, wrap180, wrap360 } from './atmo.js';

const TAN3 = Math.tan(3 * DEG);

export class Autopilot {
  constructor(ac) { this.ac = ac; this.reset(); }

  reset() {
    this.fcu = { spd: 250, spdMan: true, hdg: 0, alt: 5000, vs: 0 };
    this.ap = false; this.athr = false; this.athrArmed = false; this.fd = true;
    this.lat = null; this.vert = null;
    this.armed = { nav: false, loc: false, gs: false };
    this.plan = null; this.app = null;           // app = { rwy, end }
    this.cmd = { phi: 0, gamma: 0, pitch: 0, roll: 0, rud: 0, active: false, vsT: 0 };
    this.n1c = 50; this.n1Trim = 55; this.lastIas = null; this.accel = 0;
    this.trkHold = null; this.vsCap = 3; this.modeTime = 0;
    this.thrMode = 'MAN THR'; this.msg = ''; this.events = [];
    this.floor = 0;
    this.speeds = null;
  }

  /* ───────── FCU 조작 ───────── */
  dispHdgToGrid(h) { return wrap360(h - (this.ac.hdgOffset || 0)); }
  setSpd(d) { this.fcu.spd = clamp(Math.round(this.fcu.spd + d), 100, 350); if (this.fcu.spdMan) { this.fcu.spdMan = false; } }
  pullSpd() { this.fcu.spdMan = false; this.fcu.spd = Math.round(this.ac.ias); }
  pushSpd() { this.fcu.spdMan = true; }
  setHdg(d) { this.fcu.hdg = wrap360(Math.round(this.fcu.hdg + d)); }
  pullHdg() { this.setLat('HDG'); this.armed.nav = false; if (!this.lat?.startsWith('LOC')) { this.armed.loc = false; this.armed.gs = false; } }
  pushHdg() {
    if (this.plan) { this.setLat('NAV'); this.armed.nav = false; }
    else this.say('경로(FMS)가 없어 NAV를 쓸 수 없습니다');
  }
  setAlt(d) { this.fcu.alt = clamp(Math.round((this.fcu.alt + d) / 100) * 100, 100, 39000); }
  pullAlt() {
    const dh = this.fcu.alt - this.ac.altFt;
    if (Math.abs(dh) < 250) return;
    this.setVert(dh > 0 ? 'OP CLB' : 'OP DES');
  }
  pushAlt() {
    const dh = this.fcu.alt - this.ac.altFt;
    if (Math.abs(dh) < 250) return;
    this.setVert(dh > 0 ? 'CLB' : (this.plan ? 'DES' : 'OP DES'));
  }
  setVs(d) {
    if (this.vert !== 'V/S') { this.fcu.vs = Math.round(this.ac.vs / FT * 60 / 100) * 100; this.setVert('V/S'); }
    this.fcu.vs = clamp(this.fcu.vs + d, -6000, 6000);
  }
  pullVs() { this.fcu.vs = Math.round(this.ac.vs / FT * 60 / 100) * 100; this.setVert('V/S'); }
  pushVs() { this.fcu.vs = 0; this.setVert('V/S'); }
  toggleAP() {
    if (this.ap) return this.disconnect('AP 해제');
    if (this.ac.wow) return this.say('지상에서는 AP를 켤 수 없습니다 (이륙 후 100ft 이상)');
    if (this.ac.raFt < 100) return this.say('100ft 이상에서 AP를 켤 수 있습니다');
    this.ap = true;
    if (!this.lat) { this.fcu.hdg = Math.round(this.ac.dispHeading); this.setLat('HDG'); }
    if (!this.vert) { this.fcu.vs = Math.round(this.ac.vs / FT * 60 / 100) * 100; this.setVert('V/S'); }
    this.events.push('ap_on');
  }
  disconnect(msg = 'AP 해제') {
    if (!this.ap) return;
    this.ap = false;
    this.events.push('ap_off');
    this.say(msg);
  }
  toggleATHR() {
    if (this.athr || this.athrArmed) { this.athr = false; this.athrArmed = false; this.events.push('athr_off'); return; }
    this.athr = true;
    this.n1Trim = this.ac.n1;
  }
  toggleFD() { this.fd = !this.fd; }
  armLoc() {
    if (!this.app) return this.say('접근 활주로가 없습니다');
    if (this.armed.loc && !this.armed.gs) { this.armed.loc = false; return; }
    this.armed.loc = true; this.armed.gs = false;
  }
  armAppr() {
    if (!this.app) return this.say('접근 활주로가 없습니다');
    if (this.armed.gs) { this.armed.gs = false; this.armed.loc = false; return; }
    this.armed.loc = !this.lat?.startsWith('LOC') && this.lat !== 'LAND';
    this.armed.gs = true;
  }
  say(t) { this.msg = t; this.msgTime = 3; }

  setLat(m) { if (this.lat !== m) { this.lat = m; this.latTime = 0; if (m === 'HDG' && this.fcu.hdg === 0) this.fcu.hdg = Math.round(this.ac.dispHeading); } }
  setVert(m) { if (this.vert !== m) { this.vert = m; this.modeTime = 0; if (m === 'ALT*') this.vsCap = Math.max(2.5, Math.abs(this.ac.vs)); } }

  /* ───────── 관리 속도 ───────── */
  iasFromMach(M) {
    const atm = isa(this.ac.pos.y);
    return M * atm.a * Math.sqrt(atm.sigma) / KT;
  }
  speedTarget() {
    const ac = this.ac, sp = this.speeds || ac.speeds();
    if (!this.fcu.spdMan) return this.fcu.spd;
    if (this.vert === 'SRS') return this.ga ? this.gaSpd : sp.v2 + 10;
    const lever = ac.ctl.flapLever;
    const near = this.plan && this.lastGuide && this.lastGuide.toRwy < 22 * NM;
    if (lever >= 4) return sp.vapp;
    if (lever === 3) return Math.round(sp.vls(3, false) + 8);
    if (lever === 2) return Math.round(sp.vls(2, false) + 15);
    if (lever === 1) return Math.round(Math.max(sp.vls(1, false) + 20, sp.greenDot - 25));
    if (near || this.vert === 'G/S' || this.vert === 'G/S*' || (this.lat || '').startsWith('LOC')) return sp.greenDot;
    const alt = ac.altFt;
    const below10 = alt < 10000;
    if (this.vert === 'DES' || this.vert === 'OP DES') return below10 ? 250 : Math.min(280, this.iasFromMach(0.76));
    if (this.vert === 'CLB' || this.vert === 'OP CLB') return below10 ? 250 : Math.min(290, this.iasFromMach(0.76));
    return below10 ? 250 : Math.min(290, this.iasFromMach(0.76));
  }

  /* ───────── 매 스텝 ───────── */
  update(dt) {
    const ac = this.ac, c = ac.ctl;
    this.modeTime += dt; this.latTime = (this.latTime || 0) + dt;
    if (this.msgTime > 0) this.msgTime -= dt; else this.msg = '';
    if (this.lastIas !== null) this.accel += ((ac.ias - this.lastIas) / dt - this.accel) * Math.min(1, dt * 1.5);
    this.lastIas = ac.ias;
    const sp = this.speeds || ac.speeds();
    const V = Math.max(40, ac.tas);
    const gamma = ac.fpa * DEG, phi = ac.bank * DEG;
    const lev = c.lever;

    /* ── 이륙 ── */
    if (ac.wow) {
      if (lev >= AC.detents.MCT - 0.01 && !c.rev && ac.gs < 80 * KT) {
        if (this.fd) { this.setVert('SRS'); this.setLat('RWY'); }
        if (!this.athr) this.athrArmed = true;
        this.trkHold = ac.track;
        if (this.plan) this.armed.nav = true;
      } else if (lev < 0.2 && ac.gs < 30 * KT && this.vert === 'SRS') { this.vert = null; this.lat = null; }
    }
    // 복행 (Go-around): 접근 중 추력 레버 TOGA
    const inApp = ['G/S', 'G/S*', 'LAND', 'FLARE'].includes(this.vert) ||
      (c.flapLever >= 1 && ac.raFt < 2500 && this.lastGuide && this.lastGuide.toRwy < 15 * NM);
    if (!ac.wow && lev > 0.99 && this.vert !== 'SRS' && inApp && ac.airTime > 10) {
      this.setVert('SRS'); this.ga = true; this.gaSpd = Math.round(Math.max(sp.vapp, ac.ias));
      this.setLat('GA TRK'); this.trkHold = ac.track;
      this.armed = { nav: false, loc: false, gs: false };
      if (this.athr) { this.athr = false; this.athrArmed = true; }
      const elevFt = this.app ? this.app.end.thr.y / FT : 0;
      this.fcu.alt = Math.max(this.fcu.alt, Math.round((elevFt + 3000) / 100) * 100);
      this.events.push('go_around');
    }
    if (this.vert !== 'SRS') this.ga = false;
    // 이륙 후 모드 전환
    if (!ac.wow && this.lat === 'RWY' && ac.raFt > 30) {
      if (this.armed.nav && this.plan) { this.setLat('NAV'); this.armed.nav = false; }
      else { this.setLat('RWY TRK'); this.trkHold = ac.track; }
    }
    if (!ac.wow && this.vert === 'SRS' && ac.raFt > 1500) {
      if (this.fcu.alt > ac.altFt + 250) this.setVert('CLB'); else this.setVert('ALT*');
    }
    // 추력 감소 고도: 레버를 CL로
    this.lvrClb = !ac.wow && ac.raFt > 1500 && lev > AC.detents.CL + 0.01 && (this.athrArmed || this.athr);
    if (this.athrArmed && Math.abs(lev - AC.detents.CL) < 0.01 && !ac.wow) { this.athr = true; this.athrArmed = false; this.n1Trim = ac.n1; }

    /* ── 포착 (ALT / LOC / G/S) ── */
    const altT = this.fcu.alt, dh = altT - ac.altFt, vsFpm = ac.vs / FT * 60;
    const climbing = ['CLB', 'OP CLB', 'SRS'].includes(this.vert) || (this.vert === 'V/S' && this.fcu.vs > 0);
    const descending = ['DES', 'OP DES'].includes(this.vert) || (this.vert === 'V/S' && this.fcu.vs < 0);
    const capDist = Math.max(120, Math.abs(vsFpm) * 0.13);
    if (((climbing && dh > 0) || (descending && dh < 0)) && Math.abs(dh) < capDist && !(this.vert === 'SRS' && ac.raFt < 400)) this.setVert('ALT*');
    if (climbing && dh < 0 && !(this.vert === 'SRS' && ac.raFt < 400)) this.setVert('ALT*');
    if (descending && dh > 0) this.setVert('ALT*');
    if (this.vert === 'ALT*' && Math.abs(dh) < 25 && Math.abs(vsFpm) < 200) this.setVert('ALT');

    // 접근 활주로 기준 편차
    let loc = null;
    if (this.app) {
      const { rwy, end } = this.app;
      const l = rwy.local(end, ac.pos);
      const distLoc = rwy.L - l.u + 300;
      const locDev = -Math.atan2(l.v, distLoc) / DEG;
      const dGs = 300 - l.u;
      const h = ac.pos.y - 2.9 - end.thr.y;
      const gsDev = Math.atan2(h, dGs) / DEG - 3;
      const hdgDiff = Math.abs(wrap180(ac.heading - end.hdg));
      if (this._lastV !== undefined) this.vdot = (l.v - this._lastV) / dt;
      this._lastV = l.v;
      loc = { ...l, locDev, gsDev, dGs, h, hdgDiff, end };
    }
    this.loc = loc;
    if (loc && this.armed.loc && Math.abs(loc.locDev) < 2.5 && loc.hdgDiff < 100 && loc.u < 0) {
      this.setLat('LOC*'); this.armed.loc = false;
    }
    if (this.lat === 'LOC*' && Math.abs(loc.locDev) < 0.25 && Math.abs(wrap180(ac.track - loc.end.hdg)) < 5 && this.latTime > 3) this.setLat('LOC');
    // G/S 포착: 아래에서 접근(편차 -0.8~+0.3°)하거나 위에서 경로를 지나칠 때
    const crossedFromAbove = loc && this._lastGsDev !== undefined && this._lastGsDev > 0 && loc.gsDev <= 0;
    if (loc && this.armed.gs && (this.lat === 'LOC' || this.lat === 'LOC*') && loc.u < 0 &&
        ((loc.gsDev < 0.3 && loc.gsDev > -0.8) || crossedFromAbove)) {
      this.setVert('G/S*'); this.armed.gs = false;
    }
    if (loc) this._lastGsDev = loc.gsDev;
    if (this.vert === 'G/S*' && this.modeTime > 4 && Math.abs(loc.gsDev) < 0.15) this.setVert('G/S');
    if ((this.vert === 'G/S' || this.vert === 'G/S*') && (this.lat === 'LOC' || this.lat === 'LOC*') && ac.raFt < 400 && !ac.wow) { this.setVert('LAND'); this.setLat('LAND'); }
    if (this.vert === 'LAND' && ac.raFt < 40 && !ac.wow) { this.setVert('FLARE'); }
    if ((this.vert === 'FLARE' || this.vert === 'LAND') && ac.wow) { this.setVert('ROLL OUT'); this.setLat('ROLL OUT'); }
    if (this.vert === 'ROLL OUT' && ac.gs < 30 * KT) { this.disconnect('자동착륙 완료 — AP 해제'); this.vert = null; this.lat = null; }
    if (this.vert === 'SRS' && ac.wow && lev < 0.2) { this.vert = null; this.lat = null; }

    /* ── 측면 명령 (경사각) ── */
    let phiC = 0, trkT = null;
    const bankLim = (this.lat === 'LAND' || this.lat === 'ROLL OUT') ? 8 : ac.raFt < 400 ? 15 : 25;
    let guide = null;
    if (this.plan && !ac.wow) guide = this.plan.update(ac);
    else if (this.plan) guide = this.plan.guidance(ac);
    this.lastGuide = guide;
    switch (this.lat) {
      case 'HDG': {
        const err = wrap180(this.dispHdgToGrid(this.fcu.hdg) - ac.heading);
        phiC = clamp(err * 1.8, -bankLim, bankLim); break;
      }
      case 'RWY TRK': case 'GA TRK': trkT = this.trkHold; break;
      case 'NAV': if (guide) trkT = wrap360(guide.crs + clamp(-guide.xte * 0.006, -45, 45)); break;
      case 'LOC*': case 'LOC': case 'LAND':
        if (loc) trkT = wrap360(loc.end.hdg + clamp(-loc.v * 0.06 - (this.vdot || 0) * 1.1, -30, 30));
        break;
    }
    if (trkT !== null) phiC = clamp(wrap180(trkT - ac.track) * 2.0, -bankLim, bankLim);
    if (this.lat === 'ROLL OUT' || this.lat === 'RWY' || ac.wow) phiC = 0;
    this.cmd.phi = phiC;
    const roll = clamp((phiC - ac.bank) * 0.035 - (-ac.w.z / DEG) * 0.012, -0.5, 0.5);

    /* ── 수직 명령 (비행경로각) ── */
    const spdT = this.speedTarget();
    this.spdTarget = spdT;
    const pitchOnSpeed = (gmin, gmax) => {
      const g = gamma + 0.008 * (ac.ias - spdT) + 0.03 * this.accel * 0.5;
      return clamp(g, gmin, gmax);
    };
    let gT = gamma, vsT = null;
    switch (this.vert) {
      case 'SRS': gT = pitchOnSpeed(0.03, (18 - ac.alpha / DEG) * DEG); break;
      case 'CLB': case 'OP CLB': gT = pitchOnSpeed(0.01, 0.25); break;
      case 'OP DES': gT = pitchOnSpeed(-0.12, -0.01); break;
      case 'DES': {
        if (guide) {
          const pa = this.plan.profileAlt(guide.s);
          const target = Math.max(pa, altT * FT);
          gT = clamp(-Math.tan(2.7 * DEG) * (pa < this.plan.cruiseAlt - 30 && pa > this.plan.iafAlt + 30 ? 1 : 0.2) + (target - ac.pos.y + 2.9) * 0.0008, -0.085, 0.0);
          if (ac.ias > spdT + 8) gT = Math.min(0, gT + 0.003 * (ac.ias - spdT - 8));
        } else gT = pitchOnSpeed(-0.12, -0.01);
        break;
      }
      case 'V/S': vsT = this.fcu.vs * FT / 60; break;
      case 'ALT*': vsT = clamp((altT - ac.altFt) * FT * 0.11, -this.vsCap, this.vsCap); break;
      case 'ALT': vsT = clamp((altT - ac.altFt) * FT * 0.08, -4, 4); break;
      case 'G/S*': case 'G/S': case 'LAND':
        if (loc) { const path = TAN3 * loc.dGs; gT = -3 * DEG + clamp((path - loc.h) * 0.0018, -0.04, 0.04); vsT = null; }
        break;
      case 'FLARE': vsT = -(0.35 + Math.max(0, ac.ra) * 0.105); break;
    }
    if (vsT !== null) gT = Math.asin(clamp(vsT / V, -0.3, 0.3));
    this.cmd.gamma = gT; this.cmd.vsT = vsT ?? Math.sin(gT) * V;
    let pitch = clamp((gT - gamma) * 6.0, -0.3, 0.3);
    if (ac.law === 'FLARE') {
      // 플레어 법칙(피치율 명령 + 기수 내림 경향)용: 경향을 상쇄하고 강하율 목표 추종
      const thRef = ac.thMem - Math.min(2 * DEG, 2 * DEG * ac.lawTime / 8);
      const bias = -0.6 * (thRef - ac.pitch * DEG) / (4.5 * DEG);
      pitch = clamp(bias + (this.cmd.vsT - ac.vs) * 0.28, -0.4, 1.0);
    }
    if (this.vert === 'ROLL OUT') pitch = -0.05;

    /* ── 오토스로틀 ── */
    const idle = ac.wow ? AC.n1IdleGround : AC.n1IdleFlight;
    const clN1 = leverToN1(AC.detents.CL, idle);
    const fp = flapParams(ac.flapPos, ac.is1F);
    if (!ac.wow && ac.alpha > fp.aStall - 2.5 * DEG && ac.ctl.flapLever > 0) this.floor = 5;
    else if (this.floor > 0) this.floor -= dt;
    let mode = 'SPEED';
    if (this.vert === 'CLB' || this.vert === 'OP CLB') mode = 'THR CLB';
    if (this.vert === 'OP DES') mode = 'THR IDLE';
    if (this.vert === 'FLARE' && ac.raFt < 20) mode = 'RETARD';
    if (this.vert === 'ROLL OUT') mode = 'IDLE';
    if (mode === 'SPEED') {
      const err = spdT - ac.ias;
      this.n1Trim = clamp(this.n1Trim + 0.35 * err * dt, idle, clN1);
      this.n1c = clamp(this.n1Trim + 1.6 * err - 4.0 * this.accel, idle, clN1);
    } else if (mode === 'THR CLB') this.n1c = clN1;
    else this.n1c = idle;
    const athrActive = (this.athr && lev > 0.02 && lev <= AC.detents.CL + 0.005 && !c.rev) || this.floor > 0;
    if (this.floor > 0) { this.n1c = AC.n1Toga; mode = 'A.FLOOR'; }
    ac.athrN1 = athrActive ? this.n1c : null;
    if (mode === 'RETARD' && this.ap && c.lever > 0) { c.lever = 0; this.events.push('retard'); }
    if (athrActive) this.thrMode = mode === 'SPEED' && ac.mach > 0.6 && !this.fcu.spdMan ? 'MACH' : mode;
    else {
      const L = lev;
      const flx = ac.flexTemp && (ac.wow || ac.flexLatched);
      this.thrMode = c.rev ? 'REV' : L > 0.99 ? 'MAN TOGA' : Math.abs(L - AC.detents.MCT) < 0.01 ? (flx ? `MAN FLX ${ac.flexTemp}` : 'MAN MCT') : L < 0.01 ? 'IDLE' : 'MAN THR';
      if (this.athr && !athrActive && L > 0.01 && L < AC.detents.CL) this.thrMode = 'THR LVR';
    }
    if (ac.wow && this.athr && this.vert === null && ac.gs < 50 * KT) { /* 착륙 후 */ this.athr = false; }

    /* ── 출력 ── */
    this.cmd.active = !!(this.lat || this.vert) && !ac.wow;
    this.cmd.pitch = pitch; this.cmd.roll = roll;
    if (this.ap) {
      c.pitch = pitch; c.roll = roll;
      if (this.lat === 'ROLL OUT' && loc) c.rudder = clamp(-(loc.v * 0.025 + (this.vdot || 0) * 0.3), -0.4, 0.4);
    }
  }

  /* FMA 표시 문자열 */
  fma() {
    const a = this.armed;
    const vertArmed = [a.gs ? 'G/S' : '', (['CLB', 'OP CLB', 'DES', 'OP DES', 'V/S', 'SRS'].includes(this.vert)) ? 'ALT' : ''].filter(Boolean).join(' ');
    const latArmed = [a.loc ? 'LOC' : '', a.nav ? 'NAV' : ''].filter(Boolean).join(' ');
    let vert = this.vert || '', lat = this.lat || '';
    if (vert === 'V/S') vert = `V/S ${this.fcu.vs > 0 ? '+' : ''}${this.fcu.vs}`;
    if (lat === 'LAND' && vert === 'LAND') { lat = ''; }
    return {
      thr: this.thrMode, thrArmed: this.athrArmed ? 'A/THR' : '',
      vert, vertArmed, lat, latArmed,
      status: [this.ap ? 'AP1' : '', this.fd ? '1FD2' : '', this.athr ? 'A/THR' : (this.athrArmed ? 'A/THR*' : '')],
      lvrClb: this.lvrClb,
    };
  }
}
