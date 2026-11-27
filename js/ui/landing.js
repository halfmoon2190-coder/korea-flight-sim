// 착륙 평가
export function evaluateLanding(td, runways, vapp) {
  // 접지 위치가 어느 활주로 · 어느 방향인지
  let best = null;
  for (const r of runways) {
    for (const end of r.ends) {
      const loc = r.local(end, td.pos);
      const hdgDiff = Math.abs(((td.heading - end.hdg + 540) % 360) - 180);
      if (hdgDiff > 60) continue;
      const onRwy = loc.u >= -60 && loc.u <= r.L && Math.abs(loc.v) <= r.W / 2 + 7.5;
      const score = Math.abs(loc.v) + (loc.u < 0 ? -loc.u : loc.u > r.L ? loc.u - r.L : 0);
      if (!best || score < best.score) best = { r, end, loc, onRwy, score, hdgDiff };
    }
  }
  const items = [];
  let pts = 100;
  const add = (label, value, grade, note, minus = 0) => { items.push({ label, value, grade, note }); pts -= minus; };

  const fpm = td.fpm;
  if (fpm < 60) add('접지 강하율', `${fpm.toFixed(0)} fpm`, 'ok', '아주 부드럽지만 너무 띄우면 활주로를 길게 씁니다', 3);
  else if (fpm <= 240) add('접지 강하율', `${fpm.toFixed(0)} fpm`, 'good', '모범적인 접지');
  else if (fpm <= 360) add('접지 강하율', `${fpm.toFixed(0)} fpm`, 'ok', '조금 단단함 — 30ft 부근에서 조금 더 당겨보세요', 10);
  else if (fpm <= 600) add('접지 강하율', `${fpm.toFixed(0)} fpm`, 'warn', '단단한 착륙 — 플레어를 일찍, 부드럽게', 25);
  else add('접지 강하율', `${fpm.toFixed(0)} fpm`, 'bad', '하드 랜딩 (정비 점검 대상)', 50);

  const g = td.peakG;
  if (g > 1.8) add('접지 충격', `${g.toFixed(2)} G`, 'bad', '', 15);
  else if (g > 1.5) add('접지 충격', `${g.toFixed(2)} G`, 'warn', '', 5);
  else add('접지 충격', `${g.toFixed(2)} G`, 'good', '');

  if (!best || !best.onRwy) {
    add('접지 위치', '활주로 밖', 'bad', '활주로를 벗어나 접지했습니다', 60);
  } else {
    const u = best.loc.u, v = best.loc.v;
    if (u < 0) add('접지 위치', `시단 전 ${(-u).toFixed(0)} m`, 'bad', '활주로 이전 접지(언더슛)!', 50);
    else if (u < 150) add('접지 위치', `시단 후 ${u.toFixed(0)} m`, 'warn', '너무 일찍 접지 — 조준점(400m)을 목표로', 10);
    else if (u <= 750) add('접지 위치', `시단 후 ${u.toFixed(0)} m`, 'good', '접지구역 안');
    else if (u <= 1200) add('접지 위치', `시단 후 ${u.toFixed(0)} m`, 'warn', '길게 접지 — 플레어 중 너무 오래 띄움', 15);
    else add('접지 위치', `시단 후 ${u.toFixed(0)} m`, 'bad', '매우 길게 접지 — 복행(재상승)을 고려할 상황', 30);
    const av = Math.abs(v);
    const side = v > 0 ? '오른쪽' : '왼쪽';
    if (av <= 3) add('중심선', `${side} ${av.toFixed(1)} m`, 'good', '');
    else if (av <= 8) add('중심선', `${side} ${av.toFixed(1)} m`, 'ok', '조금 벗어남', 8);
    else add('중심선', `${side} ${av.toFixed(1)} m`, 'warn', '중심선에서 많이 벗어남', 18);
  }
  if (Math.abs(td.bank) > 5) add('경사각', `${td.bank.toFixed(1)}°`, 'warn', '날개를 수평으로', 10);
  else add('경사각', `${td.bank.toFixed(1)}°`, 'good', '');
  if (td.pitch > 9) add('기수 자세', `${td.pitch.toFixed(1)}°`, 'warn', '꼬리 접촉 위험 (11.7°)', 12);
  else if (td.pitch < 0.5) add('기수 자세', `${td.pitch.toFixed(1)}°`, 'warn', '앞바퀴 먼저 접지 위험', 15);
  else add('기수 자세', `${td.pitch.toFixed(1)}°`, 'good', '');
  const dv = td.ias - vapp;
  if (dv < -8) add('접지 속도', `${td.ias.toFixed(0)} kt`, 'warn', `느림 (VAPP ${vapp}kt 대비 ${dv.toFixed(0)})`, 10);
  else if (dv > 12) add('접지 속도', `${td.ias.toFixed(0)} kt`, 'warn', `빠름 (VAPP ${vapp}kt 대비 +${dv.toFixed(0)})`, 10);
  else add('접지 속도', `${td.ias.toFixed(0)} kt`, 'good', `VAPP ${vapp}kt 기준`);

  pts = Math.max(0, Math.round(pts));
  const grade = pts >= 90 ? 'A' : pts >= 75 ? 'B' : pts >= 60 ? 'C' : 'D';
  const title = { A: '훌륭한 착륙!', B: '좋은 착륙', C: '무난한 착륙', D: '연습이 더 필요합니다' }[grade];
  return { pts, grade, title, items, runway: best && best.onRwy ? best.end.name : null, airport: best?.r?.airport?.icao };
}
