// 비행 화면: 모든 모듈 연결 + 메인 루프
import * as THREE from '../vendor/three.module.min.js';
import { Aircraft } from './sim/aircraft.js';
import { AC } from './sim/a320.js';
import { KT, FT, NM, DEG, clamp } from './sim/atmo.js';
import { createEnvironment, createPracticeWorld } from './world/world.js';
import { createKoreaWorld } from './world/korea.js';
import { AIRPORTS } from './geo/airports.js';
import { MAG_VAR_W, toLatLon, trueToMag } from './geo/proj.js';
import { Minimap } from './ui/minimap.js';
import { Autopilot } from './sim/autopilot.js';
import { FlightPlan } from './nav/fms.js';
import { RouteGuide } from './view/routeguide.js';
import { ND_RANGES } from './ui/nd.js';
import { ChecklistState, CHECKLISTS } from './ops/checklists.js';
import { FlightMonitor } from './ops/monitor.js';
import { Weather, WX_PRESETS } from './sim/weather.js';
import { Clouds } from './world/clouds.js';
import { ATC } from './ops/atc.js';
import { FailureManager, FAILURES } from './ops/failures.js';
import { defaultBrief, computeBrief, renderBrief, briefSummary, ChecklistPanel, showReport, saveLog, showLogbook, exportCsv, clearLog } from './ui/ops.js';
import { buildAircraftModel } from './view/model.js';
import { CameraRig } from './view/camera.js';
import { Cockpit } from './view/cockpit.js';
import { Input, ACTIONS, saveSettings, defaultSettings } from './input.js';
import { Instruments } from './ui/instruments.js';
import { Audio } from './audio.js';
import { SCENARIOS, WEIGHTS, ROUTE_STARTS, setupRoute, findRunwayEnd } from './scenarios.js';
import { evaluateLanding } from './ui/landing.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('kfs.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kfs.' + k, JSON.stringify(v)); } catch { /* 무시 */ } },
};

/* ───────── 초기화 ───────── */
const quality = store.get('quality', 'medium');
const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance', logarithmicDepthBuffer: true });
const dpr = window.devicePixelRatio || 1;
renderer.setPixelRatio(quality === 'high' ? Math.min(dpr, 1.5) : quality === 'medium' ? Math.min(dpr, 1.0) : Math.min(dpr, 0.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('view3d').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 1, 60000);
const env = createEnvironment(scene, quality);
const practice = createPracticeWorld(scene, quality);
let korea = null;                 // 노선 모드 선택 시 불러옴
let world = practice;
const rwy = practice.runways[0];

const ac = new Aircraft(world.groundAt);
const model = buildAircraftModel(quality);
scene.add(model.root);
const rig = new CameraRig(camera, renderer.domElement);
const cockpit = new Cockpit(quality);
scene.add(cockpit.root);
let cockpit3d = store.get('cockpit3d_v2', false);
const PANEL_SIZES = { large: 0.40, medium: 0.32, small: 0.25 };
let panelSize = store.get('panelSize', 'medium');
rig.towerPos.copy(world.towerFor(ac.pos));
const input = new Input();
const minimap = new Minimap($('minimap'));
const ap = new Autopilot(ac);
const rings = new RouteGuide(scene);
rings.enabled = store.get('guide', false);
let ndRange = store.get('ndRange', 40);
const brief = Object.assign(defaultBrief(), store.get('brief', {}));
let briefRes = null, briefKey = '';
const perfCache = {};
const clState = new ChecklistState();
const clPanel = new ChecklistPanel(clState);
let monitor = null, reportShown = false, lastWarnings = [];
// 5단계: 날씨 · 시간대 · 관제 · 고장
const weather = new Weather();
const clouds = new Clouds(scene);
const envCfg = Object.assign({ wx: 'calm', tod: 'day', fail: 'none', atc: false, cs: 'KFS101',
  custom: { dir: 270, spd: 12, gust: 0, turb: 0.25, vis: 10000, base: 3000, cover: 0.3 } }, store.get('env', {}));
const atc = new ATC({
  say: (t) => { if (store.get('callout', true)) audio.say(t, 1.08); },
  onMsg: (m) => showRadio(m),
  onDeviation: (t) => monitor?.add('flight', t, -5),
});
const failures = new FailureManager({ onFail: (f) => showEcam(f) });
const landLight = new THREE.SpotLight(0xfff2dd, 0, 1600, 0.24, 0.5, 2);
landLight.position.set(0, -1.2, -13); landLight.target.position.set(0, -40, -400);
model.root.add(landLight); model.root.add(landLight.target);
const inst = new Instruments($('hud'));
inst.scale = ({ large: 0.40, medium: 0.32, small: 0.25 })[store.get('panelSize', 'medium')] || 0.32;
const audio = new Audio();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
});

/* ───────── 상태 ───────── */
let scenario = SCENARIOS.find(s => s.id === store.get('scenario', 'final4')) || SCENARIOS[1];
let mode = store.get('mode', 'route');
const route = Object.assign({ dep: 'RKSI', depRwy: '33L', dest: 'RKPC', destRwy: '07', start: 'takeoff' }, store.get('route', {}));
let timeScale = 1;
let flight = null;               // 노선 비행 기록 {start, depIcao, destIcao}
let weightKey = store.get('weight', 'normal');
let running = false, paused = false, modalOpen = true;
let speeds = ac.speeds();
let pendingResult = null;

/* ───────── 메뉴 ───────── */
function setWorld(w) {
  world = w;
  practice.group.visible = w === practice;
  if (korea) korea.group.visible = w === korea;
  ac.groundAt = w.groundAt;
  ac.isWater = w.kind === 'korea' ? w.isWater : null;
}

async function ensureKorea() {
  if (korea) return korea;
  $('loadingTerrain').hidden = false;
  korea = await createKoreaWorld(scene, quality, (f) => { $('loadBar').style.width = Math.round(f * 100) + '%'; });
  scene.add(korea.group);
  minimap.setTerrain(korea);
  $('loadBar').style.width = '100%';
  $('loadingTerrain').hidden = true;
  return korea;
}

function rwyNames(icao) {
  const ap = AIRPORTS.find(a => a.icao === icao);
  return ap.runways.flatMap(r => [r.le, r.he]);
}
function buildRouteMenu() {
  const fill = (sel, items, val) => { sel.innerHTML = ''; for (const [v, t] of items) sel.add(new Option(t, v)); sel.value = val; };
  const aps = AIRPORTS.map(a => [a.icao, `${a.short} (${a.icao})`]);
  if (!rwyNames(route.dep).includes(route.depRwy)) route.depRwy = rwyNames(route.dep)[0];
  if (!rwyNames(route.dest).includes(route.destRwy)) route.destRwy = rwyNames(route.dest)[0];
  fill($('rDep'), aps, route.dep);
  fill($('rDest'), aps, route.dest);
  fill($('rDepRwy'), rwyNames(route.dep).map(n => [n, 'RWY ' + n]), route.depRwy);
  fill($('rDestRwy'), rwyNames(route.dest).map(n => [n, 'RWY ' + n]), route.destRwy);
  const list = $('routeStarts'); list.innerHTML = '';
  for (const st of ROUTE_STARTS) {
    const b = document.createElement('div');
    b.className = 'scen' + (st.id === route.start ? ' sel' : '');
    b.innerHTML = `<b>${st.title}</b><p>${st.desc}</p>`;
    b.onclick = () => { route.start = st.id; store.set('route', route); buildRouteMenu(); };
    b.ondblclick = () => startFlight();
    list.appendChild(b);
  }
  const a = AIRPORTS.find(x => x.icao === route.dep), b = AIRPORTS.find(x => x.icao === route.dest);
  let info = '';
  if (a !== b) {
    const R = 6371008.8, D = Math.PI / 180;
    const p1 = a.lat * D, p2 = b.lat * D, dl = (b.lon - a.lon) * D;
    const dist = 2 * R * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)) / 1852;
    const brg = (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D + 360) % 360;
    const fl = dist > 160 ? 'FL280' : 'FL200';
    info = `노선 <b>${a.short} → ${b.short}</b> · 거리 <b>${dist.toFixed(0)} NM</b> · 자방위 <b>${Math.round(trueToMag(brg))}°</b> · 권장 순항 ${fl} · 예상 약 ${Math.round(dist / 400 * 60 + 15)}분 (시간 가속 가능)`;
  } else info = '같은 공항 — 이착륙·장주 연습 (시작 방식에서 접근/최종접근을 고르면 도착 활주로로 접근합니다)';
  if (b.note) info += `<br>※ ${b.short}: ${b.note}`;
  $('routeInfo').innerHTML = info;
  $('briefSum').textContent = briefRes && briefKey === routeKey() ? briefSummary(briefRes) : '기본값: 승객 150명 · 화물 1.5t · 연료 자동 계산 (눌러서 조정)';
}
['rDep', 'rDepRwy', 'rDest', 'rDestRwy'].forEach(id => $(id).addEventListener('change', () => {
  route.dep = $('rDep').value; route.dest = $('rDest').value;
  route.depRwy = $('rDepRwy').value; route.destRwy = $('rDestRwy').value;
  store.set('route', route); buildRouteMenu();
}));
document.querySelectorAll('.tabs [data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; store.set('mode', mode); buildMenu(); }));

function buildMenu() {
  document.querySelectorAll('.tabs [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
  $('routePanel').hidden = mode !== 'route';
  $('practicePanel').hidden = mode !== 'practice';
  if (mode === 'route') buildRouteMenu();
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
  ws.parentElement.hidden = mode === 'route';    // 노선 비행은 운항 준비의 탑재량 사용
  $('optQuality').value = quality;
  $('optSound').checked = store.get('sound', true);
  $('optCallout').checked = store.get('callout', true);
  $('optGuide').checked = store.get('guide', false);
  $('optFd').checked = store.get('fd', true);
  $('opt3d').checked = cockpit3d;
  $('optPanel').value = panelSize;
  buildEnvMenu();
  updateSpeedsInfo();
}
function applyWeight() {
  if (mode === 'route') return;
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
$('optGuide').onchange = (e) => { store.set('guide', e.target.checked); rings.enabled = e.target.checked; };
$('optFd').onchange = (e) => { store.set('fd', e.target.checked); ap.fd = e.target.checked; };
$('opt3d').onchange = (e) => { cockpit3d = e.target.checked; store.set('cockpit3d_v2', cockpit3d); };
$('optPanel').onchange = (e) => { panelSize = e.target.value; store.set('panelSize', panelSize); inst.scale = PANEL_SIZES[panelSize]; };
$('startBtn').onclick = () => startFlight();
$('resumeBtn').onclick = () => closeModal('menu');

async function startFlight() {
  if (mode === 'route') {
    await ensureKorea();
    setWorld(korea);
    if (!briefRes || briefKey !== routeKey()) recomputeBrief();
    applyBrief();
    speeds = ac.speeds(AC.oew + ac.payload + ac.fuelInit);
    setupRoute(ac, korea, route, speeds);
    if (ac.toFlap === 2 && ac.wow) { ac.ctl.flapLever = 2; ac.flapPos = 2; ac.is1F = false; }
    flight = { startTime: ac.time, dep: route.dep, dest: route.dest };
  } else {
    applyWeight();
    ac.toFlap = 1; ac.flexTemp = null;
    speeds = ac.speeds(AC.oew + ac.payload + ac.fuelInit);
    setWorld(practice);
    scenario.setup(ac, rwy, speeds);
    flight = null;
  }
  ac.hdgOffset = hdgOffsetAt();
  ac.updateDerived();
  timeScale = 1;
  speeds = ac.speeds();
  setupAutoflight();
  setupMonitor();
  setupEnvironment();
  input.pitch = input.roll = 0;
  running = true; paused = false;
  $('pauseLabel').hidden = true;
  $('result').hidden = true; $('crash').hidden = true; $('report').hidden = true;
  pendingResult = null; reportShown = false;
  const isTakeoff = mode === 'route' ? route.start === 'takeoff' : scenario.id === 'takeoff';
  rig.set(isTakeoff ? 'cockpit' : rig.view);
  rig.towerPos.copy(world.towerFor(ac.pos));
  rig.update(ac, model, 0.016);
  if (world.prime) world.prime(camera.position);
  if (mode === 'route') minimap.mode = Math.max(minimap.mode, 1);
  audio.enabled = store.get('sound', true); audio.callouts = store.get('callout', true);
  audio.start(); audio.spoken.clear();
  closeModal('menu');
  const title = mode === 'route' ? `${route.dep} → ${route.dest} · ${ROUTE_STARTS.find(s => s.id === route.start).title}` : scenario.title;
  toast(title + (isTakeoff ? ' — N: 주기 브레이크 해제, 4: TOGA' : ''), 4000);
}

const MODALS = ['menu', 'settings', 'help', 'brief', 'report', 'logbook'];
function openModal(id) {
  for (const m of MODALS) $(m).hidden = m !== id;
  modalOpen = true;
  if (id === 'menu') { $('resumeBtn').hidden = !running || !!ac.crashed; $('endBtn').hidden = !running || reportShown; buildMenu(); }
  if (id === 'settings') buildSettings();
  if (id === 'help') buildHelp();
  audio.mute(true);
}
function closeModal(id) {
  $(id).hidden = true;
  if (id === 'settings' && running === false) return openModal('menu');
  if (id === 'help' && !running) return openModal('menu');
  modalOpen = MODALS.some(m => !$(m).hidden);
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
    case 'checklist': if (running) clPanel.toggle(); return;
    case 'panelLook':
      if (!running) return;
      if (cockpit3d && rig.view === 'cockpit') { const p = rig.togglePanelLook(); if (p !== false) toast(p ? '계기판 보기 (Q: 바깥 보기)' : '바깥 보기'); return; }
      { // 2D: 계기판 크기 순환 (크게 → 보통 → 작게 → 숨김)
        const order = ['large', 'medium', 'small', 'hidden'];
        const cur = inst.visible ? panelSize : 'hidden';
        const nx = order[(order.indexOf(cur) + 1) % order.length];
        if (nx === 'hidden') { inst.visible = false; toast('계기판 숨김 (Q: 다시 표시)'); }
        else { inst.visible = true; panelSize = nx; store.set('panelSize', nx); inst.scale = PANEL_SIZES[nx]; toast('계기판 ' + { large: '크게', medium: '보통', small: '작게' }[nx]); }
      }
      return;
    case 'logbook': showLogbook(); modalOpen = true; return;
    case 'closeLogbook': closeModal('logbook'); return;
    case 'closeReport': closeModal('report'); return;
    case 'closeBrief': closeModal('brief'); openModal('menu'); return;
    case 'endFlight': $('crash').hidden = true; closeModal('menu'); finishFlight(); return;
    case 'map': minimap.mode = (minimap.mode + 1) % 3; toast(['지도 끄기', '지도: 전체', '지도: 주변 60NM'][minimap.mode]); return;
  }
  if (!running || modalOpen) return;
  if (fcuAction(a)) return;
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
    case 'gravityGear': c.gravityGear = true; c.gearDown = true; toast('랜딩기어 중력 비상 내림 — 약 20초'); break;
    case 'autobrake': c.autobrake = (c.autobrake + 1) % 4; toast('오토브레이크 ' + ['끔', 'LO', 'MED', 'MAX'][c.autobrake]); break;
    case 'timeUp': case 'timeDown': {
      const next = a === 'timeUp' ? Math.min(8, timeScale * 2) : Math.max(1, timeScale / 2);
      if (next > 1 && !timeAccelAllowed()) { toast('시간 가속은 지상 2,500ft 이상 순항 중에만 가능합니다'); break; }
      timeScale = next; toast(timeScale > 1 ? `시간 ×${timeScale}` : '시간 정상'); break;
    }
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
    // 노선 비행 중에는 도착 활주로를 우선 표시
    cand.pref = mode === 'route' && r.airport && r.airport.icao === route.dest && end.name === route.destRwy;
    if (!best || (cand.pref && !best.pref) || (cand.pref === best.pref && Math.abs(cand.locDev) < Math.abs(best.locDev))) best = cand;
  }
  return best;
}

/* ───────── 이벤트 · 경고 ───────── */
function processEvents() {
  while (ap.events.length) {
    const e = ap.events.shift();
    if (e === 'ap_off') { apOffAlert(); }
    if (e === 'retard') audio.say('retard', 1.1);
    if (e === 'go_around') {
      audio.say('go around, flaps', 1.1);
      const end = ap.app.end;
      const plan = new FlightPlan(world, { start: { x: ac.pos.x, z: ac.pos.z, alt: ac.pos.y - 2.9 }, end, cruiseAlt: ap.fcu.alt * FT });
      ap.plan = plan; rings.setPlan(plan);
      toast('복행 — 추력 TOGA, 플랩 한 단 올림, 상승 확인 후 기어 올림. 다시 접근하려면 HDG 누름(NAV) 후 APPR', 6000);
    }
  }
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
    monitor?.onTouchdown({ ...r, fpm: Math.round(td.fpm) });
    $('resGrade').textContent = r.grade; $('resGrade').className = 'grade ' + r.grade;
    $('resTitle').textContent = `${r.title} (${r.pts}점)`;
    let sub = r.runway ? `활주로 ${r.runway}` : '활주로 밖 접지';
    if (flight && r.runway) {
      const mins = Math.round((td.time - flight.startTime) / 60);
      const apName = AIRPORTS.find(x => x.icao === (r.airport || flight.dest))?.short || '';
      sub = `${apName} ${sub} · 비행시간 ${mins}분`;
    }
    $('resSub').textContent = sub;
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
  if (!ac.crashed && running && terrainAhead()) ws.unshift({ id: 'TERRAIN', level: 'red', text: 'TERRAIN · PULL UP 지형 접근' });
  lastWarnings = ws;
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
    if (w.id === 'TERRAIN') audio.warn('TERRAIN', 'terrain, terrain, pull up', 3);
    if (w.level === 'red' && timeScale > 1) { timeScale = 1; toast('경고 — 시간 가속 해제'); }
  }
}

/* ───────── 메인 루프 ───────── */
const DT = 1 / 120;
let acc = 0, last = performance.now(), fpsAcc = 0, fpsN = 0, warnT = 0, spT = 0, fcuT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const frozen = !running || paused || modalOpen || !!ac.crashed;
  input.update(dt, ac, frozen);
  if (!frozen) {
    if (timeScale > 1 && !timeAccelAllowed()) { timeScale = 1; toast('저고도 — 시간 가속 해제'); }
    acc += dt * timeScale;
    let n = 0;
    const maxN = 24 * timeScale;
    const userTakeover = Math.abs(input.pitch) > 0.35 || Math.abs(input.roll) > 0.35;
    while (acc >= DT && n < maxN) {
      if (ap.ap && userTakeover) ap.disconnect('조종간 입력 — AP 해제');
      ac.wind = weather.sample(DT, ac.altFt, Math.max(0, ac.ra), ac.hdgOffset || 0);
      ap.update(DT);
      ac.step(DT); acc -= DT; n++;
    }
    if (n >= maxN) acc = 0;
    ac.hdgOffset = hdgOffsetAt();
  }
  processEvents();
  if (running && monitor && !frozen) {
    monitor.update(dt * timeScale, lastWarnings, ap.lastGuide);
    if (monitor.t.stop && !reportShown && performance.now() > (pendingReportAt ||= performance.now() + 2500)) finishFlight();
  }
  if (running && monitor && !frozen) {
    atc.update(dt * timeScale, ac, ap, monitor.phase, ap.lastGuide, ap.plan);
    failures.update(dt * timeScale, ac, ap, monitor.phase, speeds);
  }
  if (running && monitor) clPanel.tick({ ac, ap, vapp: speeds.vapp, phase: monitor.phase, dt, onComplete: (cl) => toast('✓ ' + cl.title + ' 완료') });

  model.root.position.copy(ac.pos);
  model.root.quaternion.copy(ac.q);
  // 3D 조종석: 렌더 전에 자세를 맞춰야 흔들림이 없음
  cockpit.root.visible = cockpit3d && rig.view === 'cockpit';
  cockpit.root.position.copy(ac.pos); cockpit.root.quaternion.copy(ac.q);
  model.update(ac, now / 1000);
  rig.update(ac, model, dt * (frozen ? 1 : timeScale));
  if (rig.view === 'tower') rig.towerPos.copy(world.towerFor(ac.pos));
  const camFt = camera.position.y / FT;
  env.update(camera, ac.pos, world.kind === 'korea' ? (quality === 'low' ? 40000 : 55000) : 34000, running && weather.inCloud(camFt));
  if (running && weather.base !== null) {
    const night = env.time === 'night';
    clouds.update(camera.position, weather.base * FT, weather.top * FT, weather.cover, scene.fog.far * 1.5, scene.fog.color,
      night ? { light: new THREE.Color(0.18, 0.2, 0.24), dark: new THREE.Color(0.08, 0.09, 0.11) } : env.time === 'day' ? { light: new THREE.Color(1, 1, 1), dark: new THREE.Color(0.72, 0.75, 0.8) } : { light: new THREE.Color(1, 0.86, 0.76), dark: new THREE.Color(0.55, 0.5, 0.55) });
  } else clouds.update(camera.position, null);
  landLight.intensity = env.time === 'night' && ac.gearPos > 0.5 && running ? 2.5e5 : 0;
  world.update(camera.position, ac.pos);
  renderer.render(scene, camera);

  const guide = computeGuide();
  const use3d = cockpit3d && rig.view === 'cockpit';
  const ndCtx = running ? { world, plan: ap.plan, ap, range: ndRange, airports: ndAirports(), wind: windInfo() } : null;
  inst.draw(ac, { view: rig.view, guide, speeds, ap, nd: ndCtx, panel3d: use3d }, frozen ? 0 : dt);
  if (use3d) {
    cockpit.update(ac, ap, inst, { guide, speeds, nd: ndCtx || { world, plan: null, ap, range: ndRange, airports: [] } }, lastWarnings, dt, env.time === 'night');
  }
  rings.update(ac, ap.lastGuide ? ap.lastGuide.s : 0, running && !ac.crashed);
  fcuT += dt; if (fcuT > 0.1) { fcuT = 0; updateFcu(); }
  audio.update(ac, rig.view, frozen);

  warnT += dt; if (warnT > 0.25) { warnT = 0; updateWarnings(); updateNav(); }
  minimap.draw(ac, world, mode === 'route' && running ? route : null);
  spT += dt; if (spT > 2) { spT = 0; if (running) { const v = speeds.vapp; speeds = ac.speeds(); speeds.vapp = v; ap.speeds = speeds; } }
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
window.__kfs = {
  ac, rig, input, startFlight, handleAction, route, minimap, renderer, ap, rings,
  get world() { return world; }, get korea() { return korea; },
  setScenario: (id) => { scenario = SCENARIOS.find(s => s.id === id); mode = 'practice'; },
  setRoute: (cfg) => { Object.assign(route, cfg); mode = 'route'; },
  get timeScale() { return timeScale; }, get monitor() { return monitor; }, get running() { return running; }, get modalOpen() { return modalOpen; },
  /** 테스트용 빨리 감기 (초) */
  weather, atc, failures, env, setEnv: (cfg) => Object.assign(envCfg, cfg),
  ff(sec) { const n = Math.round(sec / DT); for (let i = 0; i < n && !ac.crashed; i++) { ac.wind = weather.sample(DT, ac.altFt, Math.max(0, ac.ra), ac.hdgOffset || 0); ap.update(DT); ac.step(DT); if (i % 120 === 0) ac.hdgOffset = hdgOffsetAt(); } processEvents(); },
};

/* ───────── 2단계 보조 기능 ───────── */
function hdgOffsetAt() {
  if (world.kind !== 'korea') return 0;
  return world.hdgOffset(ac.pos.x, ac.pos.z) + MAG_VAR_W;
}
function timeAccelAllowed() {
  return !ac.wow && ac.raFt > 2500 && !ac.crashed;
}
/** 지상 접근 경고: 현재 속도로 10~40초 뒤 위치의 지형과 비교 */
function terrainAhead() {
  if (ac.wow || ac.raFt > 5000 || ac.tas < 50) return false;
  const landing = ac.gearPos > 0.9 && ac.ctl.flapLever >= 3;
  for (const t of [10, 20, 30, 40]) {
    const x = ac.pos.x + ac.vel.x * t, z = ac.pos.z + ac.vel.z * t, y = ac.pos.y + ac.vel.y * t;
    const g = world.groundAt(x, z);
    const margin = landing ? 30 : 150;
    if (y - g < margin && !(landing && nearRunway(x, z))) return true;
  }
  return false;
}
function nearRunway(x, z) {
  for (const r of world.runways) if (Math.hypot(x - r.center.x, z - r.center.z) < r.L / 2 + 6000) return true;
  return false;
}
function updateNav() {
  const box = $('navBox'), tb = $('timeBox');
  tb.hidden = timeScale <= 1; tb.textContent = `시간 ×${timeScale}`;
  if (!(running && mode === 'route' && korea && world === korea)) { box.hidden = true; return; }
  const nv = korea.nav(ac.pos, route.dest);
  const brg = Math.round(trueToMag(nv.brgTrue));
  const gs = Math.max(ac.gs / KT, 1);
  const ete = nv.distNm / gs * 60;
  const tod = Math.max(0, (ac.altFt - nv.ap.elevFt - 3000) / 1000 * 3 + 10);   // 3NM/1000ft 강하 + 10NM
  box.hidden = false;
  box.style.top = '52px'; box.style.right = '10px'; box.style.left = 'auto';
  box.innerHTML = `목적지 <b>${nv.ap.short} ${nv.ap.icao}</b> · RWY ${route.destRwy}<br>` +
    `거리 <b>${nv.distNm.toFixed(0)} NM</b> · 방위 <b>${String(brg).padStart(3, '0')}°</b> (현재 ${String(Math.round(ac.dispHeading)).padStart(3, '0')}°)<br>` +
    `예상 ${ete < 600 ? Math.round(ete) + '분' : '--'} · 강하 시작 약 ${Math.round(tod)} NM 전` +
    (nv.distNm < tod && ac.altFt > nv.ap.elevFt + 4000 ? ' <b>← 강하하세요</b>' : '');
}

/* ───────── 3단계: 자동비행 ───────── */
function setupAutoflight() {
  ap.reset();
  ap.fd = store.get('fd', true);
  ap.speeds = speeds;
  let dst, depEnd = null, destName = '', cruiseAlt;
  if (mode === 'route') {
    dst = findRunwayEnd(korea, route.dest, route.destRwy);
    if (route.start === 'takeoff') depEnd = findRunwayEnd(korea, route.dep, route.depRwy).end;
    destName = route.dest;
    if (route.start === 'cruise') cruiseAlt = ac.pos.y - 2.9;
  } else {
    dst = { rwy, end: rwy.ends[0] };
    if (scenario.id === 'takeoff') depEnd = rwy.ends[0];
    cruiseAlt = 3000 * FT;
    destName = 'TRNG';
  }
  if (mode === 'route' && briefRes && route.start !== 'cruise') cruiseAlt = briefRes.cruiseFt * FT;
  const plan = new FlightPlan(world, { start: { x: ac.pos.x, z: ac.pos.z, alt: ac.pos.y - 2.9 }, depEnd, end: dst.end, destName, cruiseAlt });
  ap.plan = plan; ap.app = dst;
  rings.setPlan(plan);
  ap.fcu.hdg = Math.round(ac.dispHeading);
  ap.fcu.spd = Math.round(Math.max(ac.ias, 160));
  ap.fcu.alt = Math.round((ac.wow ? plan.cruiseAlt / FT : ac.altFt) / 100) * 100;
  const start = mode === 'route' ? route.start : scenario.id;
  if (start === 'cruise') {
    ac.ctl.lever = AC.detents.CL;
    ap.athr = true; ap.n1Trim = ac.n1;
    ap.ap = true; ap.setLat('NAV'); ap.setVert('ALT');
    ap.fcu.alt = Math.round(ac.altFt / 100) * 100;
    toast('AP1 · A/THR 켜진 상태로 순항 중 — ND의 T/D에서 강하하세요', 4000);
  }
}

function ndAirports() {
  if (world.kind === 'korea') return korea.airports.map(a => ({ x: a.geo.pos.x, z: a.geo.pos.z, name: a.icao }));
  return [{ x: 0, z: 0, name: 'TRNG' }];
}

let apOffTimer = null;
function apOffAlert() {
  let el = document.getElementById('apOff');
  if (!el) { el = document.createElement('div'); el.id = 'apOff'; el.textContent = 'AP OFF'; document.body.appendChild(el); }
  el.hidden = false;
  clearTimeout(apOffTimer); apOffTimer = setTimeout(() => { el.hidden = true; }, 2500);
  audio.beep(880, 0.15); setTimeout(() => audio.beep(660, 0.15), 180); setTimeout(() => audio.beep(880, 0.15), 360);
}

/** FCU 조작 (키보드 · 버튼 공통). 처리했으면 true */
function fcuAction(a, shift = false) {
  const big = shift;
  switch (a) {
    case 'ap': ap.toggleAP(); break;
    case 'athr':
      ap.toggleATHR();
      if (ap.athr && ac.ctl.lever > AC.detents.CL + 0.01) toast('A/THR은 추력 레버가 CL(2) 이하일 때 작동합니다');
      break;
    case 'loc': ap.armLoc(); break;
    case 'appr': ap.armAppr(); break;
    case 'fd': ap.fd = !ap.fd; store.set('fd', ap.fd); toast(ap.fd ? 'FD 켜짐' : 'FD 꺼짐'); break;
    case 'guide': rings.enabled = !rings.enabled; store.set('guide', rings.enabled); toast(rings.enabled ? '3D 경로 링 켜짐' : '3D 경로 링 꺼짐'); break;
    case 'ndDn': case 'ndUp': {
      const i = ND_RANGES.indexOf(ndRange);
      ndRange = ND_RANGES[Math.max(0, Math.min(ND_RANGES.length - 1, (i < 0 ? 2 : i) + (a === 'ndUp' ? 1 : -1)))];
      store.set('ndRange', ndRange); break;
    }
    case 'spd-': ap.setSpd(big ? -10 : -1); break;
    case 'spd+': ap.setSpd(big ? 10 : 1); break;
    case 'spdPull': ap.pullSpd(); break;
    case 'spdPush': ap.pushSpd(); break;
    case 'hdg-': ap.setHdg(big ? -10 : -1); break;
    case 'hdg+': ap.setHdg(big ? 10 : 1); break;
    case 'hdgPull': ap.pullHdg(); break;
    case 'hdgPush': ap.pushHdg(); break;
    case 'alt-': ap.setAlt(big ? -1000 : -100); break;
    case 'alt+': ap.setAlt(big ? 1000 : 100); break;
    case 'altPull': ap.pullAlt(); break;
    case 'altPush': ap.pushAlt(); break;
    case 'vs-': ap.setVs(-100); break;
    case 'vs+': ap.setVs(100); break;
    case 'vsPull': ap.pullVs(); break;
    case 'vsPush': ap.pushVs(); break;
    default: return false;
  }
  updateFcu();
  return true;
}
document.querySelectorAll('#fcu [data-f]').forEach(b => b.addEventListener('click', (e) => { if (running && !modalOpen) fcuAction(b.dataset.f, e.shiftKey); b.blur(); }));
document.querySelectorAll('#fcu .fcu-sec').forEach(sec => {
  const k = sec.dataset.k;
  sec.querySelector('.win').addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!running || modalOpen) return;
    fcuAction(k + (e.deltaY < 0 ? '+' : '-'), e.shiftKey);
  }, { passive: false });
});

function updateFcu() {
  const el = $('fcu');
  el.hidden = !running || !inst.visible;
  if (el.hidden) return;
  const f = ap.fcu;
  $('fSpd').textContent = f.spdMan ? '---●' : String(f.spd);
  const latMan = ['NAV', 'LOC*', 'LOC', 'LAND', 'ROLL OUT'].includes(ap.lat);
  $('fHdg').textContent = latMan ? '---●' : String(f.hdg).padStart(3, '0');
  $('fAlt').textContent = String(f.alt).padStart(5, '0') + (['CLB', 'DES'].includes(ap.vert) ? '●' : '');
  $('fVs').textContent = ap.vert === 'V/S' ? (f.vs >= 0 ? '+' : '−') + String(Math.abs(f.vs)).padStart(4, '0') : '-----';
  const set = (id, lit, arm) => { const b = $(id); b.classList.toggle('lit', !!lit); b.classList.toggle('arm', !lit && !!arm); };
  set('bAp', ap.ap); set('bAthr', ap.athr, ap.athrArmed);
  set('bLoc', ['LOC*', 'LOC', 'LAND'].includes(ap.lat) && !ap.armed.gs && !['G/S', 'G/S*', 'LAND'].includes(ap.vert), ap.armed.loc && !ap.armed.gs);
  set('bAppr', ['G/S', 'G/S*', 'LAND', 'FLARE'].includes(ap.vert), ap.armed.gs);
  set('bFd', ap.fd); set('bGuide', rings.enabled);
  $('fcuMsg').textContent = ap.msg || '';
}

/* ───────── 4단계: 운항 준비 · 감시 · 평가 ───────── */
let pendingReportAt = 0;
function routeKey() { return `${route.dep}|${route.depRwy}|${route.dest}|${route.destRwy}`; }
function routeGeo() {
  const dep = findRunwayEnd(korea, route.dep, route.depRwy), dst = findRunwayEnd(korea, route.dest, route.destRwy);
  const plan = new FlightPlan(korea, { start: { x: dep.end.thr.x, z: dep.end.thr.z, alt: dep.end.thr.y }, depEnd: dep.end, end: dst.end });
  const depAp = AIRPORTS.find(a => a.icao === route.dep), dstAp = AIRPORTS.find(a => a.icao === route.dest);
  return {
    planDistNm: plan.totalToRwy / NM, planCruiseFt: Math.round(plan.cruiseAlt / FT / 1000) * 1000,
    depRwyLen: Math.round(dep.rwy.L), destRwyLen: Math.round(dst.rwy.L), depElevFt: depAp.elevFt, destElevFt: dstAp.elevFt,
    speedsFor: (m) => ac.speeds(m),
    wind: (() => {
      const wx = new Weather();
      wx.set(envCfg.wx === 'custom' ? envCfg.custom : WX_PRESETS[envCfg.wx]);
      const mag = (dst.end.hdg + korea.hdgOffset(dst.end.thr.x, dst.end.thr.z) + MAG_VAR_W + 360) % 360;
      wx.resolve(mag);
      const c = wx.components(mag);
      return wx.spd < 1 ? null : { text: wx.atis(), head: c.head, cross: c.cross };
    })(),
  };
}
function recomputeBrief() {
  briefRes = computeBrief(brief, route, routeGeo(), perfCache);
  briefKey = routeKey();
  return briefRes;
}
function applyBrief() {
  const r = briefRes;
  ac.payload = r.payload;
  let fuel = r.fuel.block - r.fuel.taxi;
  if (route.start === 'cruise') fuel -= r.fuel.trip * 0.5;
  if (route.start === 'app12' || route.start === 'final4') fuel -= r.fuel.trip * 0.95;
  ac.fuelInit = Math.max(1500, fuel);
  ac.toFlap = +brief.toFlap;
  ac.flexTemp = r.thrust === 'FLEX' ? r.flexTemp : null;
}
async function openBrief() {
  await ensureKorea();
  toast('이착륙 성능 계산 중…', 1500);
  await new Promise(r => setTimeout(r, 30));
  for (const m of MODALS) $(m).hidden = m !== 'brief';
  modalOpen = true;
  const upd = () => { recomputeBrief(); renderBrief(brief, briefRes, route); };
  upd();
  const bind = (id, key, num = false) => { $(id).onchange = () => { brief[key] = num ? +$(id).value : $(id).value; store.set('brief', brief); upd(); }; };
  bind('bPax', 'pax', true); bind('bCargo', 'cargo', true); bind('bExtra', 'extra', true); bind('bFl', 'fl');
  bind('bAltn', 'altn'); bind('bFlap', 'toFlap', true); bind('bThr', 'thrust'); bind('bFlex', 'flex'); bind('bAb', 'ab', true);
}
$('briefBtn').onclick = () => openBrief();
$('bApply').onclick = () => { closeModal('brief'); startFlight(); };
$('bSave').onclick = () => { closeModal('brief'); openModal('menu'); };
$('lbCsv').onclick = () => exportCsv();
$('lbClear').onclick = () => clearLog();

function setupMonitor() {
  clState.reset();
  const start = mode === 'route' ? route.start : scenario.id;
  const exp = {
    takeoff: ['before_to', 'after_to', 'approach', 'landing', 'after_ldg'],
    cruise: ['approach', 'landing', 'after_ldg'], free: ['approach', 'landing', 'after_ldg'],
    app12: ['approach', 'landing', 'after_ldg'], final12: ['approach', 'landing', 'after_ldg'], circuit: ['approach', 'landing', 'after_ldg'],
    final4: ['landing', 'after_ldg'],
  }[start] || [];
  clState.current = exp[0] || 'before_to';
  const depAp = mode === 'route' ? AIRPORTS.find(a => a.icao === route.dep) : { elevFt: 0 };
  const dstAp = mode === 'route' ? AIRPORTS.find(a => a.icao === route.dest) : { elevFt: 0 };
  monitor = new FlightMonitor({
    ac, ap, vr: speeds.vr, vapp: speeds.vapp, depElevFt: depAp.elevFt, destElevFt: dstAp.elevFt,
    cruiseFt: ap.plan ? ap.plan.cruiseAlt / FT : null, checklists: clState, expectedChecklists: exp,
    fuelPlan: mode === 'route' && briefRes ? { trip: Math.round(briefRes.fuel.trip * (start === 'takeoff' ? 1 : start === 'cruise' ? 0.5 : 0.05)), reserve: briefRes.fuel.reserve, alternate: briefRes.fuel.alternate } : null,
    startedOnGround: ac.wow, landRwy: ap.app,
  });
  pendingReportAt = 0;
}
function finishFlight() {
  if (!monitor || reportShown) return;
  reportShown = true;
  const start = mode === 'route' ? ROUTE_STARTS.find(s => s.id === route.start).title : scenario.title;
  const routeText = mode === 'route' ? `${route.dep} ${route.depRwy} → ${route.dest} ${route.destRwy} · ${start}` : `연습 공항 · ${start}`;
  const wxTxt = envCfg.wx !== 'calm' ? ' · ' + (envCfg.wx === 'custom' ? '사용자 날씨' : WX_PRESETS[envCfg.wx].label.split(' (')[0]) : '';
  const todTxt = envCfg.tod !== 'day' ? ' · ' + { dawn: '새벽', dusk: '석양', night: '야간' }[envCfg.tod] : '';
  const failTxt = failures.fired ? ' · 고장: ' + FAILURES[failures.pick].label : '';
  const rep = monitor.report({ routeText: routeText + wxTxt + todTxt + failTxt });
  for (const m of MODALS) $(m).hidden = true;
  showReport(rep); modalOpen = true;
  saveLog({
    date: rep.date, route: mode === 'route' ? `${route.dep}→${route.dest}` : '연습', start, flightMin: rep.flightMin, blockMin: rep.blockMin,
    fuelUsed: rep.fuelUsed, fuelRemain: rep.fuelRemain, maxAlt: rep.maxAlt, landingGrade: rep.landing?.grade ?? null, landingPts: rep.landing?.pts ?? null,
    fpm: rep.landing?.fpm ?? null, ga: rep.ga, overall: rep.overall, grade: rep.grade, crashed: rep.crashed,
  });
}

/* ───────── 5단계: 환경 · 훈련 ───────── */
function buildEnvMenu() {
  const wp = $('wxPreset');
  if (!wp.options.length) {
    for (const [k, p] of Object.entries(WX_PRESETS)) wp.add(new Option(p.label, k));
    wp.add(new Option('사용자 설정', 'custom'));
    for (const [k, f] of Object.entries(FAILURES)) $('failSel').add(new Option(f.label, k));
    const save = () => { store.set('env', envCfg); envSummary(); };
    wp.onchange = () => { envCfg.wx = wp.value; $('wxCustom').hidden = wp.value !== 'custom'; save(); };
    $('tod').onchange = () => { envCfg.tod = $('tod').value; save(); };
    $('failSel').onchange = () => { envCfg.fail = $('failSel').value; save(); };
    $('atcOn').onchange = () => { envCfg.atc = $('atcOn').checked; save(); };
    $('callsign').onchange = () => { envCfg.cs = ($('callsign').value || 'KFS101').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); save(); };
    const cf = [['wDir', 'dir'], ['wSpd', 'spd'], ['wGust', 'gust'], ['wTurb', 'turb'], ['wVis', 'vis'], ['wBase', 'base'], ['wCover', 'cover']];
    for (const [id, k] of cf) $(id).onchange = () => { envCfg.custom[k] = +$(id).value; save(); };
  }
  wp.value = envCfg.wx; $('tod').value = envCfg.tod; $('failSel').value = envCfg.fail; $('atcOn').checked = envCfg.atc; $('callsign').value = envCfg.cs;
  const c = envCfg.custom;
  $('wDir').value = c.dir; $('wSpd').value = c.spd; $('wGust').value = c.gust; $('wTurb').value = c.turb; $('wVis').value = c.vis; $('wBase').value = c.base; $('wCover').value = c.cover;
  $('wxCustom').hidden = envCfg.wx !== 'custom';
  envSummary();
}
function envSummary() {
  const t = { day: '낮', dawn: '새벽', dusk: '석양', night: '밤' }[envCfg.tod];
  const w = envCfg.wx === 'custom' ? `바람 ${envCfg.custom.dir}°/${envCfg.custom.spd}kt` : WX_PRESETS[envCfg.wx].label.split(' (')[0];
  $('envSum').textContent = `— ${w} · ${t}${envCfg.atc ? ' · 관제' : ''}${envCfg.fail !== 'none' ? ' · 고장: ' + FAILURES[envCfg.fail].label : ''}`;
}
function destRunwayMag() {
  if (!ap.app) return 0;
  return (ap.app.end.hdg + hdgOffsetAt() + 360) % 360;
}
function setupEnvironment() {
  const p = envCfg.wx === 'custom' ? { ...envCfg.custom, base: envCfg.custom.cover > 0 ? envCfg.custom.base : null } : WX_PRESETS[envCfg.wx];
  weather.set(p);
  weather.resolve(destRunwayMag());
  env.setConditions({ time: envCfg.tod, vis: weather.vis, overcast: weather.cover > 0.8 ? weather.cover : weather.cover * 0.3 });
  practice.setNight(envCfg.tod === 'night');
  korea?.setNight(envCfg.tod === 'night');
  clouds.key = '';
  // 관제
  atc.enabled = envCfg.atc;
  $('radio').hidden = true;
  if (envCfg.atc) {
    const start = mode === 'route' ? route.start : scenario.id;
    const depAp = mode === 'route' ? AIRPORTS.find(a => a.icao === route.dep) : null;
    const dstAp = mode === 'route' ? AIRPORTS.find(a => a.icao === route.dest) : null;
    const wxEn = () => weather.spd < 1 ? 'calm' : `${String(Math.round(weather.dir / 10) * 10 || 360).padStart(3, '0')} at ${Math.round(weather.spd)}${weather.gust ? ` gusting ${Math.round(weather.spd + weather.gust)}` : ''}`;
    atc.start({
      cs: envCfg.cs, dep: mode === 'route' ? route.dep : 'TRNG', dest: mode === 'route' ? route.dest : 'TRNG',
      depRwy: mode === 'route' ? route.depRwy : '33L', destRwy: mode === 'route' ? route.destRwy : '33L', start,
      cruiseFt: Math.round((ap.plan ? ap.plan.cruiseAlt / FT : 5000) / 100) * 100,
      iafFt: Math.round((ap.plan ? ap.plan.iafAlt / FT : 3000) / 100) * 100,
      depElevFt: depAp ? depAp.elevFt : 0, destElevFt: dstAp ? dstAp.elevFt : 0,
      wxText: () => weather.atis(), wxEn,
    });
  }
  // 고장
  ac.fail = { eng: [false, false], gear: false, flaps: false };
  ac.ctl.gravityGear = false;
  failures.reset(envCfg.fail);
  $('ecam').hidden = true;
}
let radioTimer = null;
function showRadio(m) {
  $('radioFrom').textContent = '📻 ' + m.from;
  $('radioKo').textContent = m.ko;
  $('radioEn').textContent = m.en + (m.readEn ? `  ↳ ${m.readEn}` : '');
  $('radio').hidden = false;
  clearTimeout(radioTimer); radioTimer = setTimeout(() => { $('radio').hidden = true; }, 11000);
}
function showEcam(f) {
  $('ecamTitle').textContent = '⚠ ' + f.title;
  $('ecamSteps').innerHTML = f.steps.map(x => `<li>${x}</li>`).join('');
  $('ecam').className = f.level === 'amber' ? 'amber' : '';
  $('ecam').hidden = false;
  audio.warn('FAIL', f.level === 'red' ? 'engine failure' : 'caution', 1);
  for (let i = 0; i < 3; i++) setTimeout(() => audio.beep(f.level === 'red' ? 1000 : 700, 0.2), i * 300);
  if (timeScale > 1) { timeScale = 1; }
  monitor?.add('flight', `고장 발생: ${f.title.split(' · ')[1] || f.title}`, 0);
  clPanel.visible = false; $('clPanel').hidden = true;
}
$('ecamOk').onclick = () => { $('ecam').hidden = true; };
function windInfo() {
  const w = ac.wind;
  const spd = Math.hypot(w.x, w.z) / KT;
  if (spd < 1) return null;
  const toGrid = Math.atan2(w.x, -w.z) / DEG;
  const fromMag = (toGrid + 180 + (ac.hdgOffset || 0) + 720) % 360;
  return { dir: fromMag, spd };
}
