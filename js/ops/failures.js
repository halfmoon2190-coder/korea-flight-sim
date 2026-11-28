// 고장 훈련: 고장 발생 시점 관리 + ECAM 경고 · 대처 절차
import { KT, FT, NM } from '../sim/atmo.js';

export const FAILURES = {
  none:      { label: '없음' },
  eng_to:    { label: '이륙 중 엔진 고장 (V1 이후)', when: 'v1' },
  eng_crz:   { label: '순항 중 엔진 고장', when: 'cruise' },
  gear:      { label: '랜딩기어 정상 내림 고장', when: 'start' },
  flaps:     { label: '플랩 고장 (현재 위치에 고정)', when: 'approach' },
  autoflt:   { label: '자동비행 고장 (AP · A/THR 사용 불가)', when: 'climb' },
  random:    { label: '무작위 (비행 중 하나)', when: 'random' },
};

const ECAM = {
  eng: (n) => ({ level: 'red', title: `ENG ${n} FAIL · 엔진 ${n} 고장`, steps: [
    '조종 유지: 러더(Z/X)로 기수 방향을 잡고 날개를 수평으로',
    '이륙 중이면 V1 이후 이륙 계속 → VR에서 회전, 속도 V2 유지',
    '추력 레버 MCT(3) — 남은 엔진 최대 연속 추력',
    '1,500ft 이상에서 가속 → 플랩 올림, 엔진 1개 비행',
    '순항 중이면 고도 유지 불가 → FCU ALT를 FL200 이하로 낮추고 강하 (드리프트다운)',
    '가까운 공항으로 회항 (착륙 거리 여유 확인)',
  ] }),
  gear: { level: 'amber', title: 'L/G GEAR NOT DOWN · 랜딩기어 내림 고장', steps: [
    '기어 레버(G) 내림 상태 확인',
    'Shift + G : 중력 비상 내림 (약 20초)',
    '초록 ▼▼▼ 3개 확인 후 정상 접근',
  ] },
  flaps: { level: 'amber', title: 'F/CTL FLAPS LOCKED · 플랩 고정', steps: [
    '플랩이 현재 위치에서 움직이지 않습니다',
    '접근 속도 증가: VAPP + 15~25kt (속도계 VLS 띠 참고)',
    '착륙 거리 증가 — 오토브레이크 MED, 역추력 최대',
    '활주로가 긴 공항(인천 4,000m)을 고려',
  ] },
  autoflt: { level: 'amber', title: 'AUTO FLT AP OFF · 자동비행 고장', steps: [
    'AP · A/THR을 사용할 수 없습니다 — 수동 비행',
    '추력 레버로 속도를 직접 조절',
    'FD(비행지시기)는 사용 가능: 초록 막대를 따라 비행',
  ] },
};

export class FailureManager {
  constructor({ onFail }) { this.onFail = onFail; this.reset('none'); }
  reset(kind) {
    this.kind = kind; this.fired = false; this.active = null; this.armT = 0;
    if (kind === 'random') {
      const pool = ['eng_crz', 'gear', 'flaps', 'autoflt'];
      this.pick = pool[Math.floor(Math.random() * pool.length)];
      this.randomDelay = 120 + Math.random() * 600;
    } else this.pick = kind;
  }
  /** 매 프레임: 조건이 되면 고장 발생 */
  update(dt, ac, ap, phase, speeds) {
    if (this.fired || this.kind === 'none') return;
    this.armT += dt;
    const k = this.pick, w = FAILURES[k]?.when;
    let go = false;
    if (this.kind === 'random') go = (k === 'gear' && phase === 'APPROACH') || (k !== 'gear' && this.armT > this.randomDelay && !ac.wow && ac.raFt > 1500);
    else if (w === 'start') go = true;
    else if (w === 'v1') go = ac.wow && ac.ias > speeds.v1 && phase === 'TAKEOFF';
    else if (w === 'cruise') go = phase === 'CRUISE' || (!ac.wow && ac.altFt > 15000 && this.armT > 60);
    else if (w === 'approach') go = !ac.wow && ac.ctl.flapLever >= 1 && ac.flapPos >= 0.95 && phase === 'APPROACH';
    else if (w === 'climb') go = !ac.wow && ac.raFt > 3000;
    if (!go) return;
    this.fired = true;
    let e;
    if (k === 'eng_to' || k === 'eng_crz') { const n = Math.random() < 0.5 ? 1 : 2; ac.fail.eng[n - 1] = true; e = ECAM.eng(n); }
    if (k === 'gear') { ac.fail.gear = true; e = ECAM.gear; }
    if (k === 'flaps') { ac.fail.flaps = true; e = ECAM.flaps; }
    if (k === 'autoflt') { ap.failed = true; ap.disconnect('자동비행 고장'); ap.athr = false; ap.athrArmed = false; e = ECAM.autoflt; }
    this.active = { ...e, kind: k, flapsAt: ac.flapPos };
    this.onFail?.(this.active);
  }
}
