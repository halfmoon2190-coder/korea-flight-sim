// 비행 화면: 모든 모듈 연결 + 메인 루프
import * as THREE from '../vendor/three.module.min.js';
import { Aircraft } from './sim/aircraft.js';
import { AC } from './sim/a320.js';
import { KT, FT, NM, DEG, clamp } from './sim/atmo.js';
import { createWorld } from './world/world.js';
import { buildAircraftModel } from './view/model.js';
import { CameraRig } from './view/camera.js';
import { Input, ACTIONS, saveSettings, defaultSettings } from './input.js';
import { Instruments } from './ui/instruments.js';
import { Audio } from './audio.js';
import { SCENARIOS, WEIGHTS } from './scenarios.js';
import { evaluateLanding } from './ui/landing.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('kfs.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kfs.' + k, JSON.stringify(v)); } catch { /* 무시 */ } },
};

/* ───────── 초기화 ───────── */
const quality = store.get('quality', 'medium');
const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
const dpr = window.devicePixelRatio || 1;
renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 1.5) : quality === 'medium' ? Math.min(dpr, 1.0) : Math.min(dpr, 0.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('view3d').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 60000);
const world = createWorld(scene, quality);
const rwy = world.runways[0];

const ac = new Aircraft(world.groundAt);
const model = buildAircraftModel(quality);
scene.add(model.root);
const rig = new CameraRig(camera, renderer.domElement);
rig.towerPos.copy(world.towerPos);
const input = new Input();
const inst = new Instruments($('hud'));
const audio = new Audio();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});

/* ───────── 상태 ───────── */
let scenario = SCENARIOS.find(s => s.id === store.get('scenario', 'final4')) || SCENARIOS[1];
let weightKey = store.get('weight', 'normal');
let running = false, paused = false, modalOpen = true;
let speeds = ac.speeds();
let pendingResult = null;

/* ───────── 메뉴 ───────── */
function buildMenu() {
  const list = $('scenarioList');
  list.innerHTML = '';
  for (const s of SCENARIOS) {
    const b = document.createElement('div');
    b.className = 'scen' + (s === scenario ? ' sel' : '');
    b.innerHTML = `<b>${s.title}</b><span class="badge">${s.badge}</span><p>${s.desc}</p>`;
    b.onclick = () => { scenario = s; store.set('scenario', s.id); buildMenu(); };
    b.ondblclick = () => startFlight();
    list.appendChild(b);
  }
  const ws = $('optWeight');
  if (!ws.options.length) for (const [k, w] of Object.entries(WEIGHTS)) ws.add(new Option(w.label, k));
  ws.value = weightKey;
  $('optQuality').value = quality;
  $('optSound').checked = store.get('sound', true);
  $('optCallout').checked = store.get('callout', true);
  updateSpeedsInfo();
}
function applyWeight() {
  const w = WEIGHTS[weightKey];
  ac.payload = w.payload; ac.fuelInit = w.fuel;
}
function updateSpeedsInfo() {
  applyWeight();
  const m = AC.oew + ac.payload + ac.fuelInit;
  const sp = ac.speeds(m);
  $('speedsInfo').innerHTML =
    `참고 속도 (${(m / 1000).toFixed(1)}t): 이륙 <b>V1 ${sp.v1}</b> · <b>VR ${sp.vr}</b> · <b>V2 ${sp.v2}</b> kt ` +
    `&nbsp;|&nbsp; 착륙 FULL <b>VLS ${sp.vlsFull}</b> · <b>VAPP ${sp.vapp}</b> kt &nbsp;|&nbsp; 클린 최소 ${sp.greenDot} kt`;
}
$('optWeight').onchange = (e) => { weightKey = e.target.value; store.set('weight', weightKey); updateSpeedsInfo(); };
$('optQuality').onchange = (e) => {
  store.set('quality', e.target.value);
  if (confirm('그래픽 설정을 적용하려면 페이지를 다시 불러옵니다. 계속할까요?')) location.reload();
};
$('optSound').onchange = (e) => { store.set('sound', e.target.checked); audio.enabled = e.target.checked; };
$('optCallout').onchange = (e) => { store.set('callout', e.target.checked); audio.callouts = e.target.checked; };
$('startBtn').onclick = () => startFlight();
$('resumeBtn').onclick = () => closeModal('menu');

function startFlight() {
  applyWeight();
  speeds = ac.speeds(AC.oew + ac.payload + ac.fuelInit);
  scenario.setup(ac, rwy, speeds);
  speeds = ac.speeds();
  input.pitch = input.roll = 0;
  running = true; paused = false;
  $('pauseLabel').hidden = true;
  $('result').hidden = true; $('crash').hidden = true;
  pendingResult = null;
  rig.set(scenario.id === 'takeoff' ? 'cockpit' : rig.view);
  audio.enabled = store.get('sound', true); audio.callouts = store.get('callout', true);
  audio.start(); audio.spoken.clear();
  closeModal('menu');
  toast(scenario.title + (scenario.id === 'takeoff' ? ' — N: 주기 브레이크 해제, 4: TOGA' : ''), 4000);
}

function openModal(id) {
  for (const m of ['menu', 'settings', 'help']) $(m).hidden = m !== id;
  modalOpen = true;
  if (id === 'menu') { $('resumeBtn').hidden = !running || !!ac.crashed; buildMenu(); }
  if (id === 'settings') buildSettings();
  if (id === 'help') buildHelp();
  audio.mute(true);
}
function closeModal(id) {
  $(id).hidden = true;
  if (id === 'settings' && running === false) return openModal('menu');
  if (id === 'help' && !running) return openModal('menu');
  modalOpen = ['menu', 'settings', 'help'].some(m => !$(m).hidden);
  if (!modalOpen) audio.mute(paused);
}

/* ───────── 설정 화면 ───────── */
function buildSettings() {
  const s = input.settings;
  const tb = $('btnTable');
  const n = Math.max(8, input.padState.buttons.length || 8);
  tb.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr'); tr.id = 'btnRow' + i;
    const sel = document.createElement('select');
    for (const [k, a] of Object.entries(ACTIONS)) sel.add(new Option(a.label, k));
    sel.value = s.buttons[i] || 'none';
    sel.onchange = () => { s.buttons[i] = sel.value; saveSettings(s); };
    tr.innerHTML = `<td class="bn">버튼 ${i}</td><td></td>`;
    tr.children[1].appendChild(sel);
    tb.appendChild(tr);
  }
  $('sensP').value = s.pitchSens; $('sensR').value = s.rollSens; $('invP').checked = s.invertPitch;
  const upd = () => { $('sensPv').textContent = (+$('sensP').value).toFixed(1) + '×'; $('sensRv').textContent = (+$('sensR').value).toFixed(1) + '×'; };
  upd();
  $('sensP').oninput = () => { s.pitchSens = +$('sensP').value; upd(); saveSettings(s); };
  $('sensR').oninput = () => { s.rollSens = +$('sensR').value; upd(); saveSettings(s); };
  $('invP').onchange = () => { s.invertPitch = $('invP').checked; saveSettings(s); };
  $('padInfo').textContent = input.padState.connected
    ? `연결된 조이스틱: ${input.padState.id} — 버튼을 누르면 해당 줄이 밝게 표시됩니다.`
    : '조이스틱이 감지되지 않았습니다. 조이스틱 버튼을 한 번 눌러주세요.';
}
$('setDefault').onclick = () => { input.settings = defaultSettings(); saveSettings(input.settings); buildSettings(); };
function drawStickTest() {
  const cv = $('stickCv'), g = cv.getContext('2d');
  g.clearRect(0, 0, 140, 140);
  g.strokeStyle = '#2a3a4b'; g.strokeRect(10, 10, 120, 120);
  g.beginPath(); g.moveTo(70, 10); g.lineTo(70, 130); g.moveTo(10, 70); g.lineTo(130, 70); g.stroke();
  const x = 70 + input.roll * 58, y = 70 + input.pitch * 58;   // 당김 = 아래
  g.fillStyle = '#2ec5ff'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8b9bab'; g.font = '11px sans-serif'; g.fillText('당김', 58, 140 - 2); g.fillText('밀기', 58, 9);
}

function buildHelp() {
  const s = input.settings;
  $('padHelp').innerHTML = '스틱: 앞/뒤 = 기수 내림/올림, 좌/우 = 기울임 (지상 저속: 앞바퀴 조향)<br>' +
    Object.entries(s.buttons).map(([b, a]) => `버튼 ${b}: ${ACTIONS[a]?.label || a}`).join('<br>');
}

/* ───────── 동작 처리 ───────── */
input.on('action', (a) => handleAction(a));
input.on('info', (t) => toast(t));
document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => handleAction(b.dataset.act)));

function handleAction(a) {
  const c = ac.ctl;
  switch (a) {
    case 'menu': if (!$('menu').hidden && running) closeModal('menu'); else openModal('menu'); return;
    case 'help': if (!$('help').hidden) closeModal('help'); else openModal('help'); return;
    case 'settings': openModal('settings'); return;
    case 'closeSettings': closeModal('settings'); if (running) openModal('menu'); return;
    case 'closeHelp': closeModal('help'); return;
    case 'closeResult': $('result').hidden = true; return;
    case 'restart': $('result').hidden = true; startFlight(); return;
    case 'hud': inst.visible = !inst.visible; return;
  }
  if (!running || modalOpen) return;
  switch (a) {
    case 'pause': paused = !paused; $('pauseLabel').hidden = !paused; audio.mute(paused); break;
    case 'view': toast('시점: ' + rig.next()); break;
    case 'flapDown': case 'flapUp': {
      const from = c.flapLever;
      c.flapLever = clamp(from + (a === 'flapDown' ? 1 : -1), 0, 4);
      if (c.flapLever === 1) ac.is1F = ac.wow || (from === 2 && ac.ias < 210);
      if (from !== c.flapLever) toast('플랩 ' + (c.flapLever === 1 && ac.is1F ? '1+F' : AC.configs[c.flapLever].name));
      break;
    }
    case 'gear':
      if (ac.wow && c.gearDown) { toast('지상에서는 기어를 올릴 수 없습니다'); break; }
      c.gearDown = !c.gearDown; toast(c.gearDown ? '랜딩기어 내림' : '랜딩기어 올림'); break;
    case 'spoiler':
      if (ac.wow) { c.sbArmed = !c.sbArmed; toast(c.sbArmed ? '지상 스포일러 ARM' : '지상 스포일러 해제'); }
      else { c.sbLever = c.sbLever >= 1 ? 0 : c.sbLever >= 0.5 ? 1 : 0.5; toast('스피드브레이크 ' + Math.round(c.sbLever * 100) + '%'); }
      break;
    case 'spoilerArm': c.sbArmed = !c.sbArmed; toast(c.sbArmed ? '지상 스포일러 ARM' : '지상 스포일러 해제'); break;
    case 'parking': c.parking = !c.parking; toast(c.parking ? '주기 브레이크 설정' : '주기 브레이크 해제'); break;
    case 'reverse':
      if (!ac.wow) { toast('역추력은 지상에서만 사용할 수 있습니다'); break; }
      c.rev = !c.rev; c.revAmt = c.rev ? 0.8 : 0; if (c.rev) c.lever = 0; toast(c.rev ? '역추력' : '역추력 해제'); break;
    case 'thrIdle': c.rev = false; c.lever = 0; break;
    case 'thrCl': c.rev = false; c.lever = AC.detents.CL; break;
    case 'thrMct': c.rev = false; c.lever = AC.detents.MCT; break;
    case 'thrToga': c.rev = false; c.lever = 1; break;
  }
}

let toastTimer = null;
function toast(text, ms = 1800) {
  const t = $('toast'); t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

/* ───────── 착륙 유도 (활주로 연장선 · 3° 활공경로) ───────── */
function computeGuide() {
  let best = null;
  for (const r of world.runways) for (const end of r.ends) {
    const loc = r.local(end, ac.pos);
    if (loc.u > 300 || loc.u < -20 * NM) continue;
    const hdgDiff = Math.abs(((ac.heading - end.hdg + 540) % 360) - 180);
    if (hdgDiff > 75) continue;
    const distLoc = r.L - loc.u + 300;                      // 반대쪽 끝 너머 로컬라이저
    const locDev = -Math.atan2(loc.v, distLoc) / DEG;
    if (Math.abs(locDev) > 10) continue;
    const dGs = 300 - loc.u;                                // 시단 300m 너머 활공경로 기준점
    const h = ac.pos.y - 2.9 - end.thr.y;
    const gsAng = Math.atan2(h, dGs) / DEG;
    const cand = { active: true, name: end.name, locDev, gsDev: gsAng - 3, gsValid: loc.u < 0 && dGs > 0, distNm: Math.max(0, -loc.u) / NM };
    if (!best || Math.abs(cand.locDev) < Math.abs(best.locDev)) best = cand;
  }
  return best;
}

/* ───────── 이벤트 · 경고 ───────── */
function processEvents() {
  while (ac.events.length) {
    const e = ac.events.shift();
    if (e.type === 'touchdown') pendingResult = { td: e.data, at: performance.now() + 2500 };
    if (e.type === 'tailstrike') { toast('⚠ 꼬리 접촉 (TAIL STRIKE)', 3000); }
    if (e.type === 'crash') {
      $('crashReason').textContent = e.reason;
      $('crash').hidden = false;
      audio.mute(true);
    }
  }
  if (pendingResult && performance.now() > pendingResult.at && !ac.crashed) {
    const td = pendingResult.td;
    const r = evaluateLanding(td, world.runways, speeds.vapp);
    pendingResult = null;
    $('resGrade').textContent = r.grade; $('resGrade').className = 'grade ' + r.grade;
    $('resTitle').textContent = `${r.title} (${r.pts}점)`;
    $('resSub').textContent = r.runway ? `활주로 ${r.runway}` : '활주로 밖 접지';
    $('resTable').innerHTML = r.items.map(it => `<tr><td>${it.label}</td><td class="g-${it.grade}">${it.value}</td><td class="muted">${it.note}</td></tr>`).join('');
    $('result').hidden = false;
    try {
      const log = store.get('logbook', []);
      log.unshift({ t: Date.now(), scen: scenario.id, pts: r.pts, grade: r.grade, fpm: Math.round(td.fpm) });
      store.set('logbook', log.slice(0, 50));
    } catch { /* 무시 */ }
  }
}

let warnKey = '';
function updateWarnings() {
  const ws = ac.crashed ? [] : ac.warnings();
  const key = ws.map(w => w.id).join(',');
  if (key !== warnKey) {
    warnKey = key;
    $('warnings').innerHTML = ws.map(w => `<div class="warn ${w.level}">${w.text}</div>`).join('');
  }
  if (paused || modalOpen) return;
  for (const w of ws) {
    if (w.id === 'STALL') audio.warn('STALL', 'stall, stall', 2);
    if (w.id === 'OVERSPEED') audio.warn('OVERSPEED', 'overspeed', 4);
    if (w.id === 'GEAR') audio.warn('GEAR', 'too low, gear', 4);
    if (w.id === 'SINK') audio.warn('SINK', 'sink rate', 3);
  }
}

/* ───────── 메인 루프 ───────── */
const DT = 1 / 120;
let acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, warnT = 0, spT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const frozen = !running || paused || modalOpen || !!ac.crashed;
  input.update(dt, ac, frozen);
  if (!frozen) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 24) { ac.step(DT); acc -= DT; n++; }
    if (n >= 24) acc = 0;
  }
  processEvents();

  model.root.position.copy(ac.pos);
  model.root.quaternion.copy(ac.q);
  model.update(ac, now / 1000);
  rig.update(ac, model, dt);
  world.update(camera.position, ac.pos);
  renderer.render(scene, camera);

  const guide = computeGuide();
  inst.draw(ac, { view: rig.view, guide, speeds }, frozen ? 0 : dt);
  audio.update(ac, rig.view, frozen);

  warnT += dt; if (warnT > 0.25) { warnT = 0; updateWarnings(); }
  spT += dt; if (spT > 2) { spT = 0; if (running) { const v = speeds.vapp; speeds = ac.speeds(); speeds.vapp = v; } }
  if (!$('settings').hidden) {
    drawStickTest();
    input.padState.buttons.forEach((b, i) => { const r = $('btnRow' + i); if (r) r.classList.toggle('on', !!b); });
  }
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps'; fpsAcc = 0; fpsN = 0; }
}

// 시작 시 메뉴 뒤 배경으로 접근 장면을 보여줌
SCENARIOS[1].setup(ac, rwy, ac.speeds());
rig.set('chase');
buildMenu();
$('loading').remove();
requestAnimationFrame(frame);

// 디버그/테스트용
window.__kfs = { ac, rig, world, input, startFlight, handleAction, setScenario: (id) => { scenario = SCENARIOS.find(s => s.id === id); } };
