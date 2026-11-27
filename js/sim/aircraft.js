// 6자유도 비행 물리 + 시스템(엔진·플랩·기어·스포일러·브레이크) + 전자식 조종(FBW) 법칙
//
// 좌표계
//   월드: x = 동쪽, y = 위, z = 남쪽 (북쪽 = -z), 단위 m
//   기체(로컬): x = 오른쪽 날개, y = 위, z = 꼬리 쪽 (기수 = -z)
//   각속도 로컬 벡터 w = (q, -r, -p)   p: 롤(오른쪽 날개 내림 +), q: 피치(기수 올림 +), r: 요(기수 오른쪽 +)
import { Vector3, Quaternion, Euler } from '../../vendor/three.module.min.js';
import { AC, flapParams, flapLabel, vfeOf, leverToN1, n1ToLever, n1ToThrustFrac, thrustFracToN1, thrustLapse } from './a320.js';
import { G, KT, FT, DEG, isa, clamp, approach, wrap360 } from './atmo.js';

const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _q = new Quaternion();

export class Aircraft {
  constructor(groundAt) {
    this.groundAt = groundAt || (() => 0);
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.q = new Quaternion();
    this.w = new Vector3();          // 로컬 각속도
    this.events = [];                // UI에 전달할 이벤트 (착지, 경고 등)
    this.reset();
  }

  /* ───────── 초기화 ───────── */
  reset() {
    if (this.payload === undefined) this.payload = 13400;   // 승객·화물 kg
    if (this.fuelInit === undefined) this.fuelInit = 8000;
    this.fuel = this.fuelInit;
    this.mass = AC.oew + this.payload + this.fuel;
    this.ctl = {
      pitch: 0, roll: 0, rudder: 0,    // 조종간(당김 +, 오른쪽 +), 러더(오른쪽 +)
      lever: 0,                         // 추력 레버 0(IDLE)~1(TOGA)
      rev: false, revAmt: 0,            // 역추력
      flapLever: 0, gearDown: true,
      sbLever: 0, sbArmed: false,       // 스피드브레이크, 지상 스포일러 ARM
      brake: 0, parking: false,
    };
    this.n1 = AC.n1IdleGround;
    this.flapPos = 0; this.is1F = false;
    this.gearPos = 1;
    this.sbPos = 0; this.gsPos = 0;
    this.elev = 0; this.ths = AC.takeoffThs; this.ail = 0; this.rud = 0; this.steer = 0;
    this.law = 'GROUND'; this.lawTime = 0;
    this.phiHold = 0; this.thMem = 0;
    this.wow = true; this.wowTime = 10; this.airTime = 0; this.gsDeployed = false; this.revPos = 0;
    this.crashed = null; this.tailStrike = false;
    this.nz = 1; this.peakG = 1;
    this.time = 0;
    this.fuelFlow = 0;
    this.touchdown = null;
    this._wasAir = false;
    this._lastF = new Vector3(0, this.mass * G, 0);
    this.w.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.updateDerived();
  }

  get inertia() {
    const r = this.mass / AC.inertiaRef.mass;
    return new Vector3(AC.inertiaRef.pitch * r, AC.inertiaRef.yaw * r, AC.inertiaRef.roll * r);
  }

  /** 자세 설정: heading(진북 기준, deg), pitch, bank(deg) */
  setAttitude(hdg, pitch, bank) {
    this.q.setFromEuler(new Euler(pitch * DEG, -hdg * DEG, -bank * DEG, 'YXZ'));
  }

  /** 활주로 위 정지 상태로 배치 */
  placeOnGround(x, z, hdg) {
    this.reset();
    const gh = this.groundAt(x, z);
    this.setAttitude(hdg, 0, 0);
    // 정적 압축 고려
    this.pos.set(x, gh + 3.3 - AC.gearStatic, z);
    this.ctl.parking = true;
    this.ctl.flapLever = 1; this.flapPos = 1; this.is1F = true;
    this.ctl.sbArmed = true;
    this.law = 'GROUND';
    this.updateDerived();
  }

  /** 공중 트림 상태로 배치: 속도(kt, IAS), 비행경로각(deg), 플랩 레버, 기어 */
  placeInAir(x, alt, z, hdg, iasKt, gammaDeg, flapLever, gearDown) {
    this.reset();
    this.ctl.flapLever = flapLever; this.flapPos = flapLever; this.is1F = false;
    this.ctl.gearDown = gearDown; this.gearPos = gearDown ? 1 : 0;
    this.ctl.sbArmed = gearDown;
    this.pos.set(x, alt, z);
    const atm = isa(alt);
    const V = iasKt * KT / Math.sqrt(atm.sigma);
    const tr = this.trim(V, gammaDeg * DEG, alt);
    this.setAttitude(hdg, (tr.alpha + gammaDeg * DEG) / DEG, 0);
    const g = gammaDeg * DEG, h = hdg * DEG;
    this.vel.set(Math.sin(h) * Math.cos(g) * V, Math.sin(g) * V, -Math.cos(h) * Math.cos(g) * V);
    this.n1 = tr.n1;
    this.ctl.lever = n1ToLever(tr.n1, AC.n1IdleFlight);
    this.ths = clamp(tr.delta, AC.thsMin, AC.thsMax);
    this.elev = 0;
    this.law = 'NORMAL'; this.wow = false; this.wowTime = 0; this.airTime = 30; this._wasAir = true;
    this.phiHold = 0; this.gammaHold = g; this.lawTime = 5;
    this.updateDerived();
    return tr;
  }

  /** 정상 비행 트림 계산 → 받음각, 추력, 수평안정판 각 */
  trim(V, gamma, alt) {
    const atm = isa(alt);
    const qS = 0.5 * atm.rho * V * V * AC.S;
    const W = this.mass * G;
    const fp = flapParams(this.flapPos, this.is1F);
    const mach = V / atm.a;
    let alpha = 0.05, T = W * 0.1;
    for (let i = 0; i < 40; i++) {
      const CL = (W * Math.cos(gamma) - T * Math.sin(alpha)) / qS;
      alpha = (CL - fp.CL0) / AC.CLa;
      const CD = this.dragCoef(CL, mach, 99);
      T = (CD * qS + W * Math.sin(gamma)) / Math.cos(alpha);
    }
    const lapse = thrustLapse(mach, atm.sigma);
    const frac = T / (AC.thrustStatic * AC.nEng * lapse);
    const n1 = Math.max(AC.n1IdleFlight, thrustFracToN1(frac));
    const Cm = AC.Cm0 + fp.dCm + AC.Cma * alpha + (-AC.thrustY * T) / (qS * AC.c);
    const delta = -Cm / AC.Cmde;
    return { alpha, T, n1, delta, frac };
  }

  dragCoef(CL, mach, hAgl) {
    const fp = flapParams(this.flapPos, this.is1F);
    let k = AC.k;
    if (hAgl < AC.b) { const r = 16 * hAgl / AC.b; k *= (r * r) / (1 + r * r); }
    let CD = AC.CD0 + fp.dCD + AC.gearCD * this.gearPos + k * CL * CL;
    CD += 0.035 * this.sbPos + 0.07 * this.gsPos;
    if (mach > 0.75) CD += 20 * Math.pow(mach - 0.75, 3) + 0.5 * Math.pow(Math.max(0, mach - 0.80), 2);
    return CD;
  }

  /* ───────── 시스템 ───────── */
  updateSystems(dt) {
    const c = this.ctl;
    // 플랩: 약 4초/단
    if (c.flapLever !== Math.round(this.flapPos) || Math.abs(c.flapLever - this.flapPos) > 1e-3) {
      this.flapPos = approach(this.flapPos, c.flapLever, 0.25, dt);
    }
    if (c.flapLever !== 1) this.is1F = false;
    if (c.flapLever === 1 && this.ias > 210) this.is1F = false;   // 210kt 이상이면 자동으로 1 로
    // 기어: 약 10초
    this.gearPos = approach(this.gearPos, c.gearDown ? 1 : 0, 0.1, dt);
    // 스피드브레이크 (FULL 플랩에서는 사용 불가)
    const sbTarget = c.flapLever === 4 ? 0 : c.sbLever;
    this.sbPos = approach(this.sbPos, sbTarget, 0.8, dt);
    // 지상 스포일러: ARM + 주바퀴 접지 + 추력 IDLE 근처
    const gsWanted = this.wow && (c.sbArmed || c.rev) && c.lever < 0.05 && this.gs > 25 * KT;
    if (gsWanted && this.wowTime > 0.3) this.gsDeployed = true;
    if (c.lever > 0.1 && !c.rev) this.gsDeployed = false;
    if (!this.wow && this.airTime > 1) this.gsDeployed = false;
    this.gsPos = approach(this.gsPos, this.gsDeployed ? 1 : 0, 2.5, dt);
    // 엔진
    const idle = this.wow ? AC.n1IdleGround : AC.n1IdleFlight;
    let n1Target;
    if (c.rev && this.wow) {
      n1Target = idle + c.revAmt * (AC.revN1Max - idle);
    } else if (this.athrN1 != null) {
      n1Target = this.athrN1;                 // 오토스로틀
    } else {
      n1Target = leverToN1(c.lever, idle);
    }
    const tau = this.n1 < 50 ? 2.2 : 1.1;
    let dn = (n1Target - this.n1) / tau;
    dn = clamp(dn, -12, this.n1 < 40 ? 6 : 14);
    this.n1 += dn * dt;
    if (this.fuel <= 0) this.n1 = approach(this.n1, 0, 8, dt);
    // 역추력 문 (전개 2초)
    this.revPos = approach(this.revPos || 0, c.rev && this.wow ? 1 : 0, 0.6, dt);
  }

  /* ───────── 메인 스텝 ───────── */
  step(dt) {
    if (this.crashed) return;
    this.time += dt;
    this.updateSystems(dt);

    const qInv = _q.copy(this.q).invert();
    const vb = _v.copy(this.vel).applyQuaternion(qInv);
    const u = -vb.z, vR = vb.x, wD = -vb.y;
    const V = Math.max(0.5, vb.length());
    const alpha = Math.atan2(wD, Math.max(u, 0.1));
    const beta = Math.asin(clamp(vR / V, -1, 1));
    const atm = isa(this.pos.y);
    const qdyn = 0.5 * atm.rho * V * V;
    const qS = qdyn * AC.S;
    const mach = V / atm.a;
    const p = -this.w.z, q = this.w.x, r = -this.w.y;
    const hAgl = Math.max(0.1, this.ra);

    // FBW → 조종면
    this.alpha = alpha; this.beta = beta; this.qdyn = qdyn; this.V = V;
    this.fbw(dt, { V, alpha, beta, qdyn, p, q, r });

    // 공력 계수
    const fp = flapParams(this.flapPos, this.is1F);
    let CL;
    const aSt = fp.aStall;
    if (alpha < aSt) CL = fp.CL0 + AC.CLa * alpha;
    else {
      const CLmax = fp.CL0 + AC.CLa * aSt;
      CL = Math.max(0.55 * CLmax, CLmax - (alpha - aSt) * 3.0);
    }
    if (alpha < -0.2) CL = fp.CL0 + AC.CLa * -0.2;
    if (hAgl < AC.b) CL *= 1 + 0.08 * (1 - hAgl / AC.b);       // 지면효과
    CL -= 0.12 * this.sbPos + 1.0 * this.gsPos * clamp(CL, 0, 1.5) / 1.5 * 0.8;
    const CD = this.dragCoef(CL, mach, hAgl);
    const CY = AC.CYb * beta + AC.CYdr * this.rud;
    const pb = p * AC.b / (2 * V), rb = r * AC.b / (2 * V), qc = q * AC.c / (2 * V);
    const Cl = AC.Clb * beta + AC.Clp * pb + AC.Clr * rb + AC.Clda * this.ail + AC.Cldr * this.rud;
    const Cn = AC.Cnb * beta + AC.Cnr * rb + AC.Cnp * pb + AC.Cndr * this.rud + AC.Cnda * this.ail;
    const Cm = AC.Cm0 + fp.dCm + AC.Cma * alpha + AC.Cmq * qc + AC.Cmde * (this.elev + this.ths)
             - 0.03 * this.gearPos * 0 + 0.02 * this.sbPos;
    this.CL = CL;

    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    // 로컬 힘
    const Floc = new Vector3(qS * CY, qS * (CL * ca + CD * sa), -qS * (CL * sa - CD * ca));
    const Mloc = new Vector3(qS * AC.c * Cm, -qS * AC.b * Cn, -qS * AC.b * Cl);

    // 추력
    const lapse = thrustLapse(mach, atm.sigma);
    const frac = n1ToThrustFrac(this.n1) * (this.fuel > 0 ? 1 : 0);
    let T = AC.thrustStatic * AC.nEng * frac * lapse;
    // 역추력: 역추력 문이 열린 만큼 앞쪽 추력이 뒤로 바뀜
    const rp = this.revPos || 0;
    const Tnet = T * (1 - rp) - T * rp * AC.revEff;
    this.thrust = Tnet;
    Floc.z += -Tnet;
    Mloc.x += -AC.thrustY * Tnet;
    // 연료 소모 (TSFC 근사)
    this.fuelFlow = Math.max(0.08 * AC.nEng * (this.n1 > 15 ? 1 : 0), T * 1.02e-5 * (1 + 0.85 * mach));
    this.fuel = Math.max(0, this.fuel - this.fuelFlow * dt);
    this.mass = AC.oew + this.payload + this.fuel;

    // 월드 힘
    const Fw = Floc.clone().applyQuaternion(this.q);
    const Mw = new Vector3();     // 월드 토크 (기어)
    const ground = this.groundForces(dt, Fw, Mw);

    // 비중력 가속도 → 하중계수
    this._lastF.copy(Fw);
    const nzVec = Fw.clone().applyQuaternion(qInv);
    this.nz = nzVec.y / (this.mass * G);
    // 가속도계 기록 (비행기록장치처럼 저역통과 필터)
    this.nzF = (this.nzF ?? 1) + (this.nz - (this.nzF ?? 1)) * Math.min(1, dt / 0.12);

    // 병진
    const acc = Fw.multiplyScalar(1 / this.mass);
    acc.y -= G;
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    // 회전
    Mloc.add(Mw.applyQuaternion(qInv));
    const I = this.inertia;
    const w = this.w;
    const Iw = new Vector3(I.x * w.x, I.y * w.y, I.z * w.z);
    const gyro = new Vector3().crossVectors(w, Iw);
    const wdot = new Vector3((Mloc.x - gyro.x) / I.x, (Mloc.y - gyro.y) / I.y, (Mloc.z - gyro.z) / I.z);
    w.addScaledVector(wdot, dt);
    const ang = w.length() * dt;
    if (ang > 1e-9) {
      _q.setFromAxisAngle(_v2.copy(w).normalize(), ang);
      this.q.multiply(_q).normalize();
    }

    this.updateDerived();
    this.checkEvents(dt, ground);
  }

  /* ───────── 랜딩기어 · 지면 ───────── */
  groundForces(dt, Fw, Mw) {
    const c = this.ctl;
    let wowMain = false, anyContact = false;
    const fwd = _v3.set(0, 0, -1).applyQuaternion(this.q);
    const wWorld = this.w.clone().applyQuaternion(this.q);
    const gearOk = this.gearPos > 0.98;
    const info = { maxVn: 0 };

    const contact = (pl, k, cdamp, opt) => {
      const r = new Vector3(...pl).applyQuaternion(this.q);
      const P = r.clone().add(this.pos);
      const gh = this.groundAt(P.x, P.z);
      const d = gh - P.y;
      if (opt.idx !== undefined) this.gearComp[opt.idx] = clamp(d, 0, 0.7);
      if (d <= 0) return 0;
      const vp = new Vector3().crossVectors(wWorld, r).add(this.vel);
      const vn = vp.y;
      if (-vn > info.maxVn) info.maxVn = -vn;
      // 올레오 완충기 근사: 스프링 + 감쇠(정적 하중 기준으로 상한)
      const Fst = k * AC.gearStatic;
      const Fd = clamp(-cdamp * Math.min(1, d / 0.08) * vn, -0.4 * Fst, 0.35 * Fst);
      let Fn = k * d + Fd;
      if (Fn < 0) Fn = 0;
      // 바퀴 방향 (수평면 투영)
      const dir = fwd.clone();
      if (opt.steer) dir.applyAxisAngle(new Vector3(0, 1, 0), -this.steer);
      dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); dir.normalize();
      const lat = new Vector3(-dir.z, 0, dir.x);    // 오른쪽
      const vl = vp.dot(dir), vs = vp.dot(lat);
      let mu = 0.015;
      if (opt.brake) mu += 0.5 * Math.max(c.brake, c.parking ? 1 : 0);
      if (opt.slide) mu = 0.45;
      const Fl = -mu * Fn * clamp(vl / (opt.brake && (c.brake > 0 || c.parking) ? 0.15 : 0.5), -1, 1);
      const Fs = -(opt.slide ? 0.45 : 0.75) * Fn * clamp(vs / 0.35, -1, 1);
      const F = new Vector3(0, Fn, 0).addScaledVector(dir, Fl).addScaledVector(lat, Fs);
      Fw.add(F);
      Mw.add(new Vector3().crossVectors(r, F));
      return Fn;
    };

    if (!this.gearComp) this.gearComp = [0, 0, 0];
    if (gearOk) {
      for (const [gi, g] of AC.gear.entries()) {
        const Fn = contact(g.p, g.k, g.c, { steer: g.steer, brake: g.brake, idx: gi });
        if (Fn > 0) { anyContact = true; if (g.brake) wowMain = true; }
      }
    }
    // 기체 접촉점
    const strikes = [];
    for (const s of AC.strikePoints) {
      if (gearOk && s.kind === 'belly') continue;
      const Fn = contact(s.p, 2.0e6, 3.0e5, { slide: true });
      if (Fn > 0) strikes.push(s.kind);
    }
    if (!gearOk) {
      // 기어가 올라간 상태라면 기어 위치 대신 동체로 받침
      const Fn = contact([0, -2.1, -2], 2.0e6, 3.0e5, { slide: true });
      if (Fn > 0) strikes.push('belly');
    }
    this.wow = wowMain;
    info.strikes = strikes;
    info.anyContact = anyContact;
    return info;
  }

  /* ───────── 전자식 조종(FBW) ───────── */
  fbw(dt, A) {
    const c = this.ctl;
    const { V, alpha, beta, qdyn, p, q, r } = A;
    const theta = this.pitch * DEG, phi = this.bank * DEG;
    const gs = clamp(3400 / Math.max(qdyn, 250), 0.2, 6);
    const prevLaw = this.law;

    // 법칙 전환
    if (this.wow) {
      if (this.law !== 'GROUND' && this.wowTime > 0.6) this.law = 'GROUND';
    } else {
      if (this.law === 'GROUND' && this.airTime > 0.3) this.law = 'NORMAL';
      if (this.law === 'NORMAL' && this.ra < 50 * FT && this.vs < -1 && this.gearPos > 0.9 && this.airTime > 5) {
        this.law = 'FLARE'; this.thMem = theta; this.lawTime = 0;
      }
      if (this.law === 'FLARE' && (this.ra > 100 * FT || this.ctl.lever > 0.9)) this.law = 'NORMAL';
    }
    if (prevLaw !== this.law) {
      this.lawTime = 0;
      if (this.law === 'NORMAL' && prevLaw === 'GROUND') {
        // 무충격 전환: 현재 승강타 합계를 수평안정판으로 이전
        this.ths = clamp(this.ths + this.elev, AC.thsMin, AC.thsMax);
        this.elev = 0;
        this.phiHold = phi;
      }
      this.gammaHold = this.fpa * DEG;
    }
    this.lawTime += dt;

    // ── 피치 ──
    if (this.law === 'GROUND') {
      let target = c.pitch >= 0 ? c.pitch * AC.elevUp : c.pitch * AC.elevDn;
      // 회전 보조: 피치율이 약 3.5°/s를 넘지 않도록 승강타를 덜어줌 (꼬리 접촉 방지)
      const qLim = 3.5 * DEG * Math.max(0.3, Math.abs(c.pitch));
      if (q > qLim) target -= (q - qLim) * 8;
      if (this.pitch > 9.5 && q > 0) target -= (this.pitch - 9.5) * DEG * 6;
      this.elev = approach(this.elev, clamp(target, -AC.elevDn, AC.elevUp), 0.9, dt);
      // 착륙 후 수평안정판을 이륙 트림으로 서서히 복귀
      if (this.wowTime > 3) this.ths = approach(this.ths, AC.takeoffThs, 0.5 * DEG, dt);
    } else if (this.law === 'NORMAL') {
      const flapsDown = this.ctl.flapLever > 0;
      const upMax = flapsDown ? 1.0 : 1.5, dnMax = flapsDown ? 1.0 : 2.0;
      const sched = V * 0.075 / G;                 // 저속에서는 비행경로 변화율(약 4.3°/s) 기준
      let dn = c.pitch >= 0 ? c.pitch * Math.min(upMax, sched) : c.pitch * Math.min(dnMax, sched * 1.2);
      const phiC = clamp(phi, -33 * DEG, 33 * DEG);
      let nzc = Math.cos(theta) / Math.cos(phiC) + dn;
      const gam = this.fpa * DEG;
      if (Math.abs(c.pitch) > 0.02 || this.lawTime < 0.5) this.gammaHold = gam;
      else nzc += clamp(3.0 * (this.gammaHold - gam), -0.3, 0.3);
      // 피치 자세 보호 (+30° / -15°)
      const thMax = (this.ias < 160 ? 25 : 30) * DEG;
      if (theta > thMax - 3 * DEG) nzc -= (theta - (thMax - 3 * DEG)) * 6;
      if (theta < -12 * DEG) nzc += (-12 * DEG - theta) * 6;
      // 받음각 보호
      const fp = flapParams(this.flapPos, this.is1F);
      const aProt = fp.aStall - 4 * DEG, aMax = fp.aStall - 1.5 * DEG;
      if (alpha > aProt) {
        const aCmd = aProt + Math.max(0, c.pitch) * (aMax - aProt);
        nzc = Math.min(nzc, Math.cos(theta) - (alpha - aCmd) * 8 - q * 1.0);
      }
      this.aProtActive = alpha > aProt;
      // 과속 보호
      const vmax = AC.vmo;
      if (this.ias > vmax + 4) nzc += (this.ias - vmax - 4) * 0.03;
      nzc = clamp(nzc, -1, 2.5);
      const e = nzc - this.nz;
      this.ths = clamp(this.ths + 0.10 * gs * e * dt - 0.0 * q * dt, AC.thsMin, AC.thsMax);
      const cmd = clamp(0.06 * gs * e - 0.55 * gs * q * 0.5, -AC.elevDn, AC.elevUp);
      this.elev = approach(this.elev, cmd, 1.2, dt);
    } else { // FLARE
      const thRef = this.thMem - Math.min(2 * DEG, 2 * DEG * this.lawTime / 8);
      const qc = c.pitch * 4.5 * DEG + 0.6 * (thRef - theta);
      const e = qc - q;
      this.ths = clamp(this.ths + 0.6 * gs * e * dt, AC.thsMin, AC.thsMax);
      const cmd = clamp(1.2 * gs * e, -AC.elevDn, AC.elevUp);
      this.elev = approach(this.elev, cmd, 1.2, dt);
    }

    // ── 롤 · 요 ──
    const rudLimit = clamp(Math.pow(160 / Math.max(this.ias, 1), 2), 0.15, 1);
    if (this.law === 'GROUND') {
      this.ail = approach(this.ail, c.roll, 3, dt);
      this.rud = approach(this.rud, c.rudder * rudLimit, 2, dt);
      this.phiHold = 0;
    } else {
      let pc;
      if (Math.abs(c.roll) > 0.02) {
        pc = c.roll * 15 * DEG;
        this.phiHold = phi;
      } else {
        let tgt = this.phiHold;
        if (Math.abs(phi) > 33 * DEG) tgt = Math.sign(phi) * 33 * DEG;
        if (this.law === 'FLARE' || this.ra < 30 * FT) tgt = this.phiHold;
        pc = clamp(1.2 * (tgt - phi), -15 * DEG, 15 * DEG);
        this.phiHold = tgt;
      }
      if (phi > 67 * DEG) pc = Math.min(pc, (67 * DEG - phi) * 3);
      if (phi < -67 * DEG) pc = Math.max(pc, (-67 * DEG - phi) * 3);
      const ff = pc * (-AC.Clp * AC.b) / (2 * V * AC.Clda);
      const cmd = clamp(ff + 1.5 * gs * (pc - p) * 0.6, -1, 1);
      this.ail = approach(this.ail, cmd, 4, dt);
      // 선회 협조 + 요 댐퍼
      const rc = G * Math.sin(phi) * Math.cos(theta) / V;
      const rcmd = clamp(c.rudder * rudLimit + (2.5 * beta + 2.0 * (rc - r)) * Math.min(gs, 2), -rudLimit, rudLimit);
      this.rud = approach(this.rud, rcmd, 2, dt);
    }

    // 앞바퀴 조향: 러더 페달 ±6°, 저속에서는 틸러(조종간 좌우 / 러더 키)로 최대 ±70°
    const gsKt = this.gs / KT;
    const tillerFade = clamp((45 - gsKt) / 25, 0, 1);
    const tiller = clamp(c.roll + c.rudder, -1, 1) * tillerFade;
    this.steer = approach(this.steer, (c.rudder * 6 + tiller * 64) * DEG, 40 * DEG, dt);
  }

  /* ───────── 파생 값 ───────── */
  updateDerived() {
    const fwd = new Vector3(0, 0, -1).applyQuaternion(this.q);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.q);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.q);
    this.fwd = fwd; this.right = right; this.up = up;
    this.pitch = Math.asin(clamp(fwd.y, -1, 1)) / DEG;
    this.bank = Math.atan2(-right.y, up.y) / DEG;
    this.heading = wrap360(Math.atan2(fwd.x, -fwd.z) / DEG);
    const atm = isa(this.pos.y);
    const V = this.vel.length();
    this.tas = V;
    // 지시대기속도 (EAS 근사): 정면 성분 기준
    this.ias = Math.sqrt(atm.sigma) * Math.max(0, this.vel.dot(fwd)) / KT;
    this.mach = V / atm.a;
    this.gs = Math.hypot(this.vel.x, this.vel.z);
    this.vs = this.vel.y;
    this.track = this.gs > 1 ? wrap360(Math.atan2(this.vel.x, -this.vel.z) / DEG) : this.heading;
    // 표시용 방위 (지도 격자 → 자북 기준). hdgOffset은 월드가 설정
    this.dispHeading = wrap360(this.heading + (this.hdgOffset || 0));
    this.dispTrack = wrap360(this.track + (this.hdgOffset || 0));
    this.fpa = V > 5 ? Math.asin(clamp(this.vel.y / V, -1, 1)) / DEG : 0;
    this.altFt = (this.pos.y - (3.3 - AC.gearStatic)) / FT;    // 정지 시 바퀴 높이 기준 (지면 = 공항 표고)
    // 전파고도계: 주바퀴 높이
    const mg = new Vector3(0, -3.3, 1.5).applyQuaternion(this.q).add(this.pos);
    this.ra = mg.y + AC.gearStatic - this.groundAt(mg.x, mg.z);
    this.raFt = this.ra / FT;
    this.flapLabel = flapLabel(this.ctl.flapLever, this.is1F);
    this.vfe = vfeOf(this.ctl.flapLever, this.is1F);
  }

  /* ───────── 이벤트 (착지 · 사고) ───────── */
  checkEvents(dt, ground) {
    const firstContact = this.wow && this.wowTime === 0;
    if (this.wow) { this.wowTime += dt; this.airTime = 0; }
    else { this.airTime += dt; this.wowTime = 0; }
    if (!ground.anyContact && !this.wow) this._wasAir = this._wasAir || this.airTime > 3;

    this.peakG = Math.max(this.peakG, this.nz);
    if (firstContact && this._wasAir) {
      // 첫 접지
      const fpm = ground.maxVn / FT * 60;
      this.touchdown = {
        fpm, ias: this.ias, pitch: this.pitch, bank: this.bank, time: this.time,
        pos: this.pos.clone(), heading: this.heading, peakG: this.nzF,
      };
      this.events.push({ type: 'touchdown', data: this.touchdown });
      this._wasAir = false;
      if (fpm > 1100) this.crash('착지 충격이 너무 큽니다 (' + Math.round(fpm) + ' fpm)');
    }
    if (this.touchdown && this.time - this.touchdown.time < 0.5) {
      this.touchdown.peakG = Math.max(this.touchdown.peakG, this.nzF);
    }
    for (const s of ground.strikes) {
      if (s === 'tail') { if (!this.tailStrike) this.events.push({ type: 'tailstrike' }); this.tailStrike = true; }
      else if (s === 'belly') this.crash(this.gearPos < 0.98 ? '랜딩기어를 내리지 않고 동체로 접촉했습니다' : '동체가 지면에 닿았습니다');
      else if (s === 'engine') this.crash('엔진이 지면에 닿았습니다 (경사각 과다)');
      else if (s === 'wing') this.crash('날개 끝이 지면에 닿았습니다 (경사각 과다)');
    }
    if (!this.wow && this.ra < -1) this.crash('지면과 충돌했습니다');
    if (this.isWater && (this.wow || ground.anyContact || ground.strikes.length) && this.isWater(this.pos.x, this.pos.z)) this.crash('바다에 착수했습니다');
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = reason;
    this.events.push({ type: 'crash', reason });
  }

  /* ───────── 경고 ───────── */
  warnings() {
    const w = [];
    const fp = flapParams(this.flapPos, this.is1F);
    if (!this.wow && this.alpha > fp.aStall - 0.5 * DEG) w.push({ id: 'STALL', level: 'red', text: 'STALL 실속' });
    const vmax = Math.min(AC.vmo, this.vfe, this.gearPos > 0.02 ? AC.vle : 999);
    if (this.ias > vmax + 4) w.push({ id: 'OVERSPEED', level: 'red', text: 'OVERSPEED 과속' });
    if (!this.wow && this.gearPos < 0.98 && this.raFt < 750 && this.vs < -1 && this.airTime > 10)
      w.push({ id: 'GEAR', level: 'red', text: 'TOO LOW GEAR 기어 내리세요' });
    if (!this.wow && this.raFt < 2500 && this.raFt > 30 && this.vs * 196.85 < -Math.max(1500, this.raFt * 1.1))
      w.push({ id: 'SINK', level: 'amber', text: 'SINK RATE 강하율 과다' });
    if (this.wow && this.ctl.parking && this.ctl.lever > 0.3) w.push({ id: 'PARK', level: 'amber', text: '주기 브레이크 걸림' });
    if (this.aProtActive && !this.wow) w.push({ id: 'APROT', level: 'amber', text: 'α PROT 받음각 보호 중' });
    if (this.fuel < 800) w.push({ id: 'FUEL', level: 'amber', text: 'FUEL LOW 연료 부족' });
    return w;
  }

  /* 참고 속도 (kt): 실속 기준 */
  vs1g(lever, is1F, mass = this.mass) {
    const pos = lever;
    const fp = flapParams(pos, is1F);
    const CLmax = fp.CL0 + AC.CLa * fp.aStall;
    return Math.sqrt(2 * mass * G / (1.225 * AC.S * CLmax)) / KT;
  }
  speeds(mass = this.mass) {
    const vsTO = this.vs1g(1, true, mass);
    const v2 = 1.13 * vsTO;
    const vlsFull = 1.23 * this.vs1g(4, false, mass);
    return {
      vr: Math.round(v2 - 4), v2: Math.round(v2), v1: Math.round(v2 - 8),
      vlsFull: Math.round(vlsFull), vapp: Math.round(vlsFull + 5),
      greenDot: Math.round(2 * mass / 1000 + 85),
      vls: (lever, is1F) => 1.23 * this.vs1g(lever, is1F, mass) * (lever === 0 ? 1.0 : 1),
    };
  }
}
