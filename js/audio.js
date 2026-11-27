// 사운드: 엔진음·바람음(WebAudio 합성) + 음성 콜아웃(브라우저 음성합성) + 경고음
export class Audio {
  constructor() {
    this.enabled = true;
    this.callouts = true;
    this.ctx = null;
    this.lastRA = null;
    this.spoken = new Set();
    this.lastWarn = {};
  }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) {          // 핑크 노이즈 근사
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    const mkNoise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };

    this.master = ctx.createGain(); this.master.gain.value = 0.6;
    this.cabin = ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 8000;
    this.cabin.connect(this.master); this.master.connect(ctx.destination);

    // 엔진: 굉음(노이즈 대역통과) + 팬 소리 + 고음 휘슬
    this.engNoise = mkNoise();
    this.engBP = ctx.createBiquadFilter(); this.engBP.type = 'bandpass'; this.engBP.Q.value = 0.7;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engNoise.connect(this.engBP).connect(this.engGain).connect(this.cabin);
    this.fan = ctx.createOscillator(); this.fan.type = 'sawtooth';
    this.fanF = ctx.createBiquadFilter(); this.fanF.type = 'lowpass'; this.fanF.frequency.value = 900;
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0;
    this.fan.connect(this.fanF).connect(this.fanGain).connect(this.cabin); this.fan.start();
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.cabin); this.whine.start();
    // 바람
    this.wind = mkNoise();
    this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass';
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.wind.connect(this.windLP).connect(this.windGain).connect(this.cabin);
    // 바퀴 굴림
    this.roll = mkNoise();
    this.rollLP = ctx.createBiquadFilter(); this.rollLP.type = 'lowpass'; this.rollLP.frequency.value = 180;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    this.roll.connect(this.rollLP).connect(this.rollGain).connect(this.cabin);
  }

  update(ac, view, paused) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.15;
    const on = this.enabled && !paused && !ac.crashed;
    const n1 = ac.n1 / 100;
    const inside = view === 'cockpit';
    this.cabin.frequency.setTargetAtTime(inside ? 1800 : 9000, t, 0.2);
    this.engBP.frequency.setTargetAtTime(150 + n1 * 900, t, k);
    this.engGain.gain.setTargetAtTime(on ? (0.05 + n1 * n1 * 0.55) * (inside ? 0.7 : 1) : 0, t, k);
    this.fan.frequency.setTargetAtTime(30 + n1 * 95, t, k);
    this.fanGain.gain.setTargetAtTime(on ? 0.02 + n1 * 0.05 : 0, t, k);
    this.whine.frequency.setTargetAtTime(900 + n1 * 2600, t, k);
    this.whineGain.gain.setTargetAtTime(on ? 0.006 + n1 * 0.01 * (inside ? 0.4 : 1) : 0, t, k);
    const v = ac.ias / 300;
    this.windLP.frequency.setTargetAtTime(300 + v * 1800, t, k);
    this.windGain.gain.setTargetAtTime(on ? Math.min(0.5, v * v * 0.6) * (1 + ac.gearPos * 0.3 + ac.sbPos * 0.4) : 0, t, k);
    this.rollGain.gain.setTargetAtTime(on && ac.wow ? Math.min(0.5, ac.gs / 60) : 0, t, 0.05);

    if (!on || !this.callouts) { this.lastRA = ac.raFt; return; }
    // 전파고도 콜아웃
    const ra = ac.raFt;
    if (this.lastRA !== null && !ac.wow && ac.vs < 0) {
      for (const [h, word] of [[2500, 'twenty five hundred'], [1000, 'one thousand'], [500, 'five hundred'], [100, 'one hundred'], [50, 'fifty'], [40, 'forty'], [30, 'thirty'], [20, 'twenty'], [10, 'ten']]) {
        if (this.lastRA > h && ra <= h && !this.spoken.has(h)) { this.say(word, 1.15); this.spoken.add(h); }
      }
      if (this.lastRA > 20 && ra <= 20 && ac.ctl.lever > 0.02) setTimeout(() => this.say('retard', 1.1), 600);
    }
    if (ra > 3000 || (ac.vs > 2 && ra > 200)) this.spoken.clear();
    this.lastRA = ra;
  }

  warn(id, text, interval = 3) {
    if (!this.enabled || !this.callouts) return;
    const now = performance.now() / 1000;
    if ((this.lastWarn[id] || 0) + interval > now) return;
    this.lastWarn[id] = now;
    this.say(text, 1.2);
    this.beep(id === 'STALL' ? 1400 : 700, 0.25);
  }

  say(text, rate = 1) {
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = rate; u.pitch = 0.9; u.volume = 0.9;
      const v = speechSynthesis.getVoices().find(v => /en-US/i.test(v.lang) && /male|David|Mark|Guy/i.test(v.name)) || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch { /* 음성 미지원 */ }
  }

  beep(freq, dur) {
    if (!this.ctx || !this.enabled) return;
    const o = this.ctx.createOscillator(), gn = this.ctx.createGain();
    o.frequency.value = freq; o.type = 'square'; gn.gain.value = 0.05;
    o.connect(gn).connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + dur);
  }

  mute(paused) { if (this.ctx) this.master.gain.setTargetAtTime(paused ? 0 : 0.6, this.ctx.currentTime, 0.05); }
}
