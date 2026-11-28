// 정상 체크리스트 (A320 표준 절차를 단순화). auto: 기체 상태로 자동 확인, 없으면 직접 클릭
import { AC } from '../sim/a320.js';

export const CHECKLISTS = [
  {
    id: 'before_to', title: '이륙 전 (BEFORE TAKEOFF)', phase: ['PREFLIGHT'],
    items: [
      { t: '이륙 성능·속도 확인 (V1/VR/V2)', note: '운항 준비 화면 또는 속도계의 1·R·2 표시' },
      { t: '플랩 이륙 위치 (1+F 또는 2)', auto: (ac) => ac.ctl.flapLever === 1 || ac.ctl.flapLever === 2 },
      { t: '지상 스포일러 ARM', auto: (ac) => ac.ctl.sbArmed, key: 'Shift + /' },
      { t: '오토브레이크 MAX (이륙 중단 대비)', auto: (ac) => ac.ctl.autobrake === 3, key: 'K' },
      { t: '비행지시기(FD) 켬', auto: (ac, ap) => ap.fd, key: 'D' },
      { t: '목표 고도(FCU ALT) 설정', auto: (ac, ap) => ap.fcu.alt >= 3000 },
      { t: '주기 브레이크 해제', auto: (ac) => !ac.ctl.parking, key: 'N' },
    ],
  },
  {
    id: 'after_to', title: '이륙 후 (AFTER TAKEOFF)', phase: ['CLIMB', 'INITIAL_CLIMB'],
    items: [
      { t: '랜딩기어 올림', auto: (ac) => ac.gearPos < 0.02, key: 'G' },
      { t: '추력 레버 CL (2)', auto: (ac) => Math.abs(ac.ctl.lever - AC.detents.CL) < 0.01, key: '2' },
      { t: '플랩 올림 (0)', auto: (ac) => ac.ctl.flapLever === 0, key: 'R' },
      { t: '오토브레이크 끔', auto: (ac) => ac.ctl.autobrake === 0, key: 'K' },
      { t: 'AP · A/THR 확인', auto: (ac, ap) => ap.ap || ap.fd, note: 'AP를 쓰지 않으면 FD를 보고 비행' },
    ],
  },
  {
    id: 'approach', title: '접근 (APPROACH)', phase: ['DESCENT', 'APPROACH'],
    items: [
      { t: '접근 브리핑: 활주로 · VAPP 확인', note: '메뉴의 참고 속도 VAPP' },
      { t: '오토브레이크 LO 또는 MED', auto: (ac) => ac.ctl.autobrake === 1 || ac.ctl.autobrake === 2, key: 'K' },
      { t: 'ILS 접근 대기 (APPR) 또는 수동 접근 결정', auto: (ac, ap) => ap.armed.gs || ['G/S', 'G/S*', 'LAND'].includes(ap.vert), note: '수동이면 직접 확인' },
      { t: '10,000ft 이하 250kt 이하', auto: (ac) => ac.altFt > 10500 || ac.ias < 255 },
      { t: '실패접근 고도(FCU ALT) 3000ft 이상', auto: (ac, ap) => ap.fcu.alt >= 3000 },
    ],
  },
  {
    id: 'landing', title: '착륙 (LANDING)', phase: ['APPROACH', 'FINAL'],
    items: [
      { t: '랜딩기어 내림 (초록 3개)', auto: (ac) => ac.gearPos > 0.98, key: 'G' },
      { t: '플랩 FULL', auto: (ac) => ac.ctl.flapLever === 4, key: 'F' },
      { t: '지상 스포일러 ARM', auto: (ac) => ac.ctl.sbArmed, key: 'Shift + /' },
      { t: '속도 VAPP 부근', auto: (ac, ap, ctx) => Math.abs(ac.ias - ctx.vapp) < 10 },
    ],
  },
  {
    id: 'after_ldg', title: '착륙 후 (AFTER LANDING)', phase: ['ROLLOUT', 'TAXI'],
    items: [
      { t: '역추력 해제', auto: (ac) => !ac.ctl.rev },
      { t: '지상 스포일러 해제', auto: (ac) => !ac.ctl.sbArmed, key: 'Shift + /' },
      { t: '플랩 올림 (0)', auto: (ac) => ac.ctl.flapLever === 0, key: 'R' },
      { t: '오토브레이크 끔', auto: (ac) => ac.ctl.autobrake === 0, key: 'K' },
      { t: '정지 후 주기 브레이크', auto: (ac) => ac.ctl.parking && ac.gs < 1, key: 'N' },
    ],
  },
];

export class ChecklistState {
  constructor() { this.reset(); }
  reset() { this.manual = {}; this.done = {}; this.current = 'before_to'; }
  itemOk(cl, i, ac, ap, ctx) {
    const it = cl.items[i];
    if (this.manual[cl.id + i]) return true;
    return it.auto ? !!it.auto(ac, ap, ctx) : false;
  }
  status(cl, ac, ap, ctx) {
    const oks = cl.items.map((_, i) => this.itemOk(cl, i, ac, ap, ctx));
    return { oks, all: oks.every(Boolean), count: oks.filter(Boolean).length };
  }
  toggle(cl, i) { const k = cl.id + i; this.manual[k] = !this.manual[k]; }
  complete(id, phase) { if (!this.done[id]) this.done[id] = { phase, t: Date.now() }; }
  /** 비행 단계에 맞는 체크리스트 자동 선택 */
  follow(phase) {
    const order = CHECKLISTS.map(c => c.id);
    const target = CHECKLISTS.find(c => c.phase.includes(phase) && !this.done[c.id]);
    if (target && order.indexOf(target.id) >= order.indexOf(this.current)) this.current = target.id;
  }
}
