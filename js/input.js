// 입력: 키보드 + 조이스틱(여러 장치 합산) + 버튼 배정 + 디지털 입력 램프 보정
import { AC } from './sim/a320.js';

export const ACTIONS = {
  thrUp:     { label: '추력 증가 (누르는 동안)', hold: true },
  thrDown:   { label: '추력 감소 (누르는 동안, IDLE에서 계속 누르면 역추력)', hold: true },
  flapUp:    { label: '플랩 올림 (1단)' },
  flapDown:  { label: '플랩 내림 (1단)' },
  gear:      { label: '랜딩기어 올림/내림' },
  brake:     { label: '브레이크 (누르는 동안)', hold: true },
  spoiler:   { label: '스피드브레이크 단계 (지상: 스포일러 ARM)' },
  view:      { label: '시점 전환' },
  parking:   { label: '주기 브레이크 켜기/끄기' },
  rudderL:   { label: '러더 왼쪽 (누르는 동안)', hold: true },
  rudderR:   { label: '러더 오른쪽 (누르는 동안)', hold: true },
  reverse:   { label: '역추력 켜기/끄기 (지상)' },
  pause:     { label: '일시정지' },
  ap:        { label: '오토파일럿(AP1) 켜기/끄기' },
  athr:      { label: '오토스로틀(A/THR) 켜기/끄기' },
  appr:      { label: 'APPR (ILS 자동접근) 대기' },
  none:      { label: '(사용 안 함)' },
};

const DEFAULT_SETTINGS = {
  buttons: { 0: 'thrUp', 1: 'thrDown', 2: 'flapUp', 3: 'flapDown', 4: 'gear', 5: 'brake', 6: 'spoiler', 7: 'view' },
  invertPitch: false,
  pitchSens: 1.0,    // 디지털 입력 램프 속도 배율
  rollSens: 1.0,
};

export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('kfs.input') || 'null');
    if (s) return { ...DEFAULT_SETTINGS, ...s, buttons: { ...DEFAULT_SETTINGS.buttons, ...(s.buttons || {}) } };
  } catch { /* 저장소 사용 불가 */ }
  return structuredClone(DEFAULT_SETTINGS);
}
export function saveSettings(s) {
  try { localStorage.setItem('kfs.input', JSON.stringify(s)); } catch { /* 무시 */ }
}
export function defaultSettings() { return structuredClone(DEFAULT_SETTINGS); }

export class Input {
  constructor() {
    this.settings = loadSettings();
    this.keys = new Set();
    this.handlers = {};
    this.pitch = 0; this.roll = 0;
    this.padState = { buttons: [], x: 0, y: 0, analogX: false, analogY: false, connected: false, id: '' };
    this.prevButtons = [];
    this.learn = null;
    this.revHold = 0;
    this.detentPause = 0;
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...a) { this.handlers[name]?.(...a); }

  onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const code = e.code;
    const flightKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown', 'Slash'];
    if (flightKeys.includes(code)) e.preventDefault();
    if (down) {
      if (this.keys.has(code)) return;      // 키 반복 무시
      this.keys.add(code);
      this.keyPress(code, e.shiftKey);
    } else this.keys.delete(code);
  }

  keyPress(code, shift) {
    const m = {
      KeyF: 'flapDown', KeyR: 'flapUp', KeyG: 'gear', KeyV: 'view', KeyT: 'reverse',
      KeyP: 'pause', KeyN: 'parking',
      Digit1: 'thrIdle', Digit2: 'thrCl', Digit3: 'thrMct', Digit4: 'thrToga',
      Escape: 'menu', KeyH: 'help', KeyI: 'hud', KeyM: 'map',
      Equal: 'timeUp', NumpadAdd: 'timeUp', Minus: 'timeDown', NumpadSubtract: 'timeDown',
    };
    if (code === 'KeyB' && shift) return this.emit('action', 'parking');
    if (code === 'KeyA') return this.emit('action', shift ? 'athr' : 'ap');
    if (code === 'KeyL') return this.emit('action', shift ? 'appr' : 'loc');
    if (code === 'KeyD') return this.emit('action', 'fd');
    if (code === 'KeyU') return this.emit('action', 'guide');
    if (code === 'Comma') return this.emit('action', 'ndDn');
    if (code === 'Period') return this.emit('action', 'ndUp');
    if (code === 'Slash') return this.emit('action', shift ? 'spoilerArm' : 'spoiler');
    if (m[code]) this.emit('action', m[code]);
  }

  pollPads() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const st = this.padState;
    st.connected = pads.length > 0;
    st.id = pads[0]?.id || '';
    let x = 0, y = 0;
    const buttons = [];
    for (const p of pads) {
      let px = p.axes[0] || 0, py = p.axes[1] || 0;
      // 햇 스위치 지원 (중립 값이 1보다 큰 축)
      for (let i = 2; i < p.axes.length; i++) {
        const v = p.axes[i];
        if (v >= -1.05 && v <= 1.05 && this._hatAxes?.has(p.index + ':' + i)) {
          const idx = Math.round((v + 1) / (2 / 7));
          const dirs = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
          if (dirs[idx]) { px = dirs[idx][0]; py = dirs[idx][1]; }
        } else if (v > 1.1) { (this._hatAxes ||= new Set()).add(p.index + ':' + i); }
      }
      if (Math.abs(px) > Math.abs(x)) x = px;
      if (Math.abs(py) > Math.abs(y)) y = py;
      const ax = Math.abs(px), ay = Math.abs(py);
      if (ax > 0.08 && ax < 0.92) st.analogX = true;
      if (ay > 0.08 && ay < 0.92) st.analogY = true;
      p.buttons.forEach((b, i) => { buttons[i] = buttons[i] || b.pressed || b.value > 0.5; });
    }
    st.x = x; st.y = y; st.buttons = buttons;

    // 버튼 눌림 이벤트
    buttons.forEach((b, i) => {
      if (b && !this.prevButtons[i]) {
        if (this.learn) { const cb = this.learn; this.learn = null; cb(i); }
        else {
          const act = this.settings.buttons[i];
          if (act && !ACTIONS[act]?.hold && act !== 'none') this.emit('action', act);
        }
        this.emit('button', i);
      }
    });
    this.prevButtons = buttons;
  }

  held(action) {
    for (const [i, a] of Object.entries(this.settings.buttons)) if (a === action && this.padState.buttons[i]) return true;
    return false;
  }

  /** 매 프레임: 조종 입력을 항공기 ctl에 반영 */
  update(dt, ac, paused) {
    this.pollPads();
    const k = this.keys, c = ac.ctl, s = this.settings;
    const st = this.padState;

    // ── 피치 / 롤 ──
    let tp = 0, tr = 0, digitalP = true, digitalR = true;
    if (k.has('ArrowDown') || k.has('Numpad2')) tp += 1;
    if (k.has('ArrowUp') || k.has('Numpad8')) tp -= 1;
    if (k.has('ArrowRight') || k.has('Numpad6')) tr += 1;
    if (k.has('ArrowLeft') || k.has('Numpad4')) tr -= 1;
    const py = s.invertPitch ? -st.y : st.y;
    if (Math.abs(py) > 0.05) { if (st.analogY) { tp = shape(py); digitalP = false; } else tp = Math.sign(py); }
    if (Math.abs(st.x) > 0.05) { if (st.analogX) { tr = shape(st.x); digitalR = false; } else tr = Math.sign(st.x); }
    this.pitch = digitalP ? ramp(this.pitch, tp, 1.45 * s.pitchSens, 4.0, dt) : tp;
    this.roll = digitalR ? ramp(this.roll, tr, 2.1 * s.rollSens, 5.0, dt) : tr;
    if (paused) return;            // 메뉴/일시정지 중에는 미리보기 값만 갱신
    c.pitch = this.pitch; c.roll = this.roll;

    // ── 러더 ──
    let rd = 0;
    if (k.has('KeyZ') || this.held('rudderL')) rd -= 1;
    if (k.has('KeyX') || this.held('rudderR')) rd += 1;
    c.rudder = ramp(c.rudder, rd, 2.0, 4.0, dt);

    // ── 추력 ──
    const up = k.has('KeyW') || k.has('PageUp') || this.held('thrUp');
    const dn = k.has('KeyS') || k.has('PageDown') || this.held('thrDown');
    if (c.rev) {
      if (dn) c.revAmt = Math.min(1, c.revAmt + 0.6 * dt);
      if (up) { c.revAmt -= 0.8 * dt; if (c.revAmt <= 0) { c.revAmt = 0; c.rev = false; this.revHold = -0.5; } }
    } else {
      const before = c.lever;
      if (this.detentPause > 0) this.detentPause -= dt;
      else {
        if (up) c.lever = Math.min(1, c.lever + 0.35 * dt);
        if (dn) c.lever = Math.max(0, c.lever - 0.45 * dt);
        // 멈춤쇠(detent): 지나갈 때 잠깐 걸림
        for (const d of [AC.detents.CL, AC.detents.MCT]) {
          if ((before < d && c.lever >= d) || (before > d && c.lever <= d)) { c.lever = d; this.detentPause = 0.35; }
        }
      }
      // IDLE에서 감소를 계속 누르면 역추력 (지상)
      if (dn && c.lever === 0 && ac.wow) {
        this.revHold += dt;
        if (this.revHold > 0.6) { c.rev = true; c.revAmt = 0; this.revHold = 0; this.emit('info', '역추력 작동'); }
      } else if (!dn) this.revHold = Math.max(0, this.revHold);
      if (!dn && this.revHold < 0) this.revHold = 0;
    }

    // ── 브레이크 ──
    const br = k.has('KeyB') || k.has('Space') || this.held('brake');
    c.brake = br ? Math.min(1, c.brake + 2.5 * dt) : 0;
  }
}

function ramp(cur, target, upRate, relRate, dt) {
  if (target === 0) {
    const d = relRate * dt;
    return Math.abs(cur) <= d ? 0 : cur - Math.sign(cur) * d;
  }
  if (Math.sign(cur) !== Math.sign(target) && cur !== 0) {
    const d = relRate * dt;
    return Math.abs(cur) <= d ? 0 : cur - Math.sign(cur) * d;
  }
  const nv = cur + Math.sign(target) * upRate * dt;
  return Math.abs(nv) > Math.abs(target) ? target : nv;
}
function shape(v) {
  const dz = 0.05;
  const a = Math.max(0, (Math.abs(v) - dz) / (1 - dz));
  return Math.sign(v) * (0.4 * a + 0.6 * a * a * a);
}
