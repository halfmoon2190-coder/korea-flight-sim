// 항법 화면 (ND, ARC 모드): 방위 원호 · 비행 경로 · 경유지 · 공항 · 지형(TERR)
import { NM, FT, KT, DEG, wrap360, wrap180, clamp } from '../sim/atmo.js';

export const ND_RANGES = [10, 20, 40, 80, 160, 320];

const terrCache = { t: 0, key: '', cells: null };

export function drawND(g, x, y, S, ac, ctx) {
  const { world, plan, ap, range = 40, airports = [] } = ctx;
  g.save();
  g.fillStyle = '#05070a'; g.fillRect(x, y, S, S);
  g.beginPath(); g.rect(x, y, S, S); g.clip();
  const cx = x + S / 2, cy = y + S * 0.84, R = S * 0.70;
  const ppm = R / (range * NM);
  const hdgG = ac.heading;                        // 격자 방위 (화면 회전 기준)
  const hdgM = ac.dispHeading;
  const off = (ac.hdgOffset || 0);
  // 월드 → 화면
  const toScr = (wx, wz) => {
    const dx = wx - ac.pos.x, dz = wz - ac.pos.z;
    const h = hdgG * DEG;
    const fwd = dx * Math.sin(h) - dz * Math.cos(h);
    const rt = dx * Math.cos(h) + dz * Math.sin(h);
    return [cx + rt * ppm, cy - fwd * ppm];
  };

  // ── 지형 (Korea 월드에서만) ──
  const terrOn = world && world.kind === 'korea' && ctx.terr !== false && !ac.wow && ac.raFt > 400;
  if (terrOn) {
    const now = performance.now();
    const key = `${range}`;
    if (now - terrCache.t > 600 || terrCache.key !== key) {
      terrCache.t = now; terrCache.key = key;
      const n = 30, cells = [];
      const h = hdgG * DEG, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
      const span = range * NM;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const f = (j + 0.5) / n * span * 1.05, r = ((i + 0.5) / n - 0.5) * 2 * span * 1.05;
        const wx = ac.pos.x + fx * f + rx * r, wz = ac.pos.z + fz * f + rz * r;
        const hh = world.groundAt(wx, wz);
        const rel = hh - (ac.pos.y - 2.9);
        // EGPWS 지형 표시: 항공기 고도 기준 상대 높이
        let col = null;
        if (hh > 1) {
          if (rel > 610) col = 'rgba(255,40,30,0.55)';           // 2000ft 이상 높음
          else if (rel > -150) col = 'rgba(255,190,0,0.45)';     // 500ft 아래 ~ 2000ft 위
          else if (rel > -610) col = 'rgba(40,170,70,0.38)';     // 500~2000ft 아래
        }
        cells.push([f, r, col]);
      }
      terrCache.cells = { cells, n, span: span * 1.05, hdg: hdgG, pos: { x: ac.pos.x, z: ac.pos.z } };
    }
    const tc = terrCache.cells;
    if (tc) {
      const cell = tc.span / tc.n * ppm;
      for (const [f, r, col] of tc.cells) {
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(cx + r * ppm - cell, cy - f * ppm - cell / 2, cell * 2 + 1, cell + 1);
      }
    }
  }

  // ── 거리 원호 · 방위 눈금 ──
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([4, 6]);
  g.beginPath(); g.arc(cx, cy, R / 2, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  g.setLineDash([]);
  g.font = `${Math.round(S * 0.04)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#3fd4ff';
  g.fillText(range / 2, cx - R / 2 * 0.86 - 10, cy - R / 2 * 0.5);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  for (let d = 0; d < 360; d += 5) {
    const rel = wrap180(d - hdgM);
    if (Math.abs(rel) > 52) continue;
    const a = (rel - 90) * DEG;
    const big = d % 10 === 0;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R + (big ? 9 : 5)), cy + Math.sin(a) * (R + (big ? 9 : 5))); g.stroke();
    if (d % 30 === 0) g.fillText(String(d / 10), cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20));
  }
  // 현재 방위 기준선
  g.strokeStyle = '#ffd23f'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy - R - 2); g.lineTo(cx, cy - R + 14); g.stroke();
  // 항적 다이아몬드
  const trkRel = wrap180(ac.dispTrack - hdgM);
  { const a = (trkRel - 90) * DEG; g.fillStyle = '#3ce36b'; diamond(g, cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8), 4, 6); }
  // 선택 방위 (청록)
  if (ap) {
    const rel = wrap180(ap.fcu.hdg - hdgM);
    if (Math.abs(rel) < 55) {
      const a = (rel - 90) * DEG;
      g.fillStyle = '#3fd4ff';
      g.save(); g.translate(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4)); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-6, -10); g.lineTo(6, -10); g.closePath(); g.fill(); g.restore();
      if (ap.lat === 'HDG') { g.strokeStyle = 'rgba(63,212,255,0.6)'; g.setLineDash([5, 5]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke(); g.setLineDash([]); }
    }
  }

  // ── 공항 ──
  g.font = `bold ${Math.round(S * 0.038)}px monospace`;
  for (const a of airports) {
    const [sx, sy] = toScr(a.x, a.z);
    if (sy > cy + 10 || Math.hypot(sx - cx, sy - cy) > R * 1.2) continue;
    g.strokeStyle = '#ff4fe0'; g.lineWidth = 1.5;
    star(g, sx, sy, 7);
    g.fillStyle = '#ff4fe0'; g.textAlign = 'left'; g.fillText(a.name, sx + 9, sy - 9);
  }
  // 활주로 (근거리)
  if (world && range <= 40) {
    g.strokeStyle = '#fff'; g.lineWidth = range <= 10 ? 4 : 2;
    for (const r of world.runways) {
      const [ax, ay] = toScr(r.ends[0].thr.x, r.ends[0].thr.z), [bx, by] = toScr(r.ends[1].thr.x, r.ends[1].thr.z);
      if (Math.min(ay, by) > cy + 20) continue;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
    }
  }
  // 접근 활주로 연장선 (점선)
  if (ap && ap.app) {
    const e = ap.app.end;
    const far = e.thr.clone().addScaledVector(e.dir, -15 * NM);
    const [ax, ay] = toScr(e.thr.x, e.thr.z), [bx, by] = toScr(far.x, far.z);
    g.strokeStyle = '#ff4fe0'; g.setLineDash([8, 6]); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
  }

  // ── 비행 경로 ──
  let toInfo = null;
  if (plan) {
    g.lineWidth = 2.2;
    let [px, py] = toScr(plan.origin.x, plan.origin.z);
    for (let i = 0; i < plan.wps.length; i++) {
      const w = plan.wps[i];
      const [sx, sy] = toScr(w.x, w.z);
      if (i >= plan.active - 1) {
        g.strokeStyle = i === plan.active ? '#3ce36b' : (i < plan.active ? '#555' : '#3ce36b');
        if (i === plan.active) g.lineWidth = 2.8; else g.lineWidth = 2;
        g.beginPath(); g.moveTo(px, py); g.lineTo(sx, sy); g.stroke();
      }
      if (i >= plan.active && w.kind !== 'map') {
        g.strokeStyle = i === plan.active ? '#fff' : '#3ce36b';
        star(g, sx, sy, 5);
        g.fillStyle = i === plan.active ? '#fff' : '#3ce36b';
        g.font = `${Math.round(S * 0.036)}px monospace`; g.textAlign = 'left';
        g.fillText(w.name + (w.alt ? ' ' + Math.round(w.alt / FT / 100) * 100 : ''), sx + 8, sy + 10);
      }
      px = sx; py = sy;
    }
    const w = plan.wps[plan.active];
    if (w) {
      const dx = w.x - ac.pos.x, dz = w.z - ac.pos.z;
      const brg = wrap360(Math.atan2(dx, -dz) / DEG + off);
      toInfo = { name: w.name, brg, dist: Math.hypot(dx, dz) / NM };
    }
    // 강하 시작점(T/D) 표시
    const gd = ap && ap.lastGuide;
    if (gd) {
      const tod = plan.todDistance(gd.s);
      if (tod > 0 && tod < range * NM * 1.1 && ac.altFt > (plan.iafAlt / FT) + 2000) {
        const pt = pointAlong(plan, gd.s + tod);
        if (pt) { const [sx, sy] = toScr(pt.x, pt.z); g.strokeStyle = '#fff'; g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.stroke(); g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText('T/D', sx + 7, sy - 6); }
      }
    }
  }

  // ── 항공기 기호 ──
  g.strokeStyle = '#ffd23f'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy - 14); g.lineTo(cx, cy + 12); g.moveTo(cx - 12, cy - 2); g.lineTo(cx + 12, cy - 2); g.moveTo(cx - 5, cy + 10); g.lineTo(cx + 5, cy + 10); g.stroke();

  // ── 문자 정보 ──
  g.textAlign = 'left'; g.font = `${Math.round(S * 0.042)}px monospace`;
  g.fillStyle = '#fff';
  g.fillText(`GS${String(Math.round(ac.gs / KT)).padStart(4)} TAS${String(Math.round(ac.tas / KT)).padStart(4)}`, x + 6, y + 14);
  if (ap && ap.app && (ap.armed.loc || ap.armed.gs || (ap.lat || '').startsWith('LOC') || ap.lat === 'LAND')) {
    g.fillStyle = '#ff4fe0'; g.fillText(`ILS ${ap.app.end.name}`, x + 6, y + 32);
  }
  if (toInfo) {
    g.textAlign = 'right';
    g.fillStyle = '#fff'; g.fillText(toInfo.name, x + S - 6, y + 14);
    g.fillStyle = '#3ce36b'; g.fillText(`${String(Math.round(toInfo.brg)).padStart(3, '0')}°  ${toInfo.dist.toFixed(1)}NM`, x + S - 6, y + 32);
  }
  g.textAlign = 'right'; g.fillStyle = '#3fd4ff';
  g.fillText(`${range}NM`, x + S - 6, y + S - 10);
  if (terrOn) { g.textAlign = 'left'; g.fillStyle = '#3ce36b'; g.fillText('TERR', x + 6, y + S - 10); }
  g.restore();
  g.strokeStyle = '#2a3440'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
}

function pointAlong(plan, s) {
  let px = plan.origin.x, pz = plan.origin.z, acc = 0;
  for (const w of plan.wps) {
    const L = Math.hypot(w.x - px, w.z - pz);
    if (acc + L >= s) { const t = (s - acc) / L; return { x: px + (w.x - px) * t, z: pz + (w.z - pz) * t }; }
    acc += L; px = w.x; pz = w.z;
  }
  return null;
}
function diamond(g, x, y, rx, ry) { g.beginPath(); g.moveTo(x, y - ry); g.lineTo(x + rx, y); g.lineTo(x, y + ry); g.lineTo(x - rx, y); g.closePath(); g.fill(); }
function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  g.stroke();
  g.beginPath(); g.moveTo(x, y - r * 0.6); g.lineTo(x + r * 0.6, y); g.lineTo(x, y + r * 0.6); g.lineTo(x - r * 0.6, y); g.closePath(); g.stroke();
}
