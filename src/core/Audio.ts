/**
 * Fully procedural audio: synthesized sound effects plus an adaptive synthwave soundtrack
 * whose layers build up with game intensity. No audio files needed.
 */
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

type Sfx =
  | 'shoot' | 'hit' | 'kill' | 'pick' | 'level' | 'hurt' | 'zap' | 'boom' | 'nova' | 'warn'
  | 'bossdie' | 'heal' | 'select' | 'dash' | 'lance' | 'missile' | 'click' | 'bomb' | 'evolve' | 'spawn' | 'heart' | 'victory';

export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private comp!: DynamicsCompressorNode;
  private noise!: AudioBuffer;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private last: Record<string, number> = {};
  muted = false;
  musicOn = true;
  sfxVol = 0.8;
  musicVol = 0.6;
  intensity = 0;
  private samples = new Map<string, AudioBuffer>();
  private step = 0;
  private nextTime = 0;
  private timer: number | null = null;
  playing = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.comp.connect(this.master);
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxVol;
      this.sfxBus.connect(this.comp);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVol * 0.55;
      this.musicBus.connect(this.comp);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // small synthetic reverb
      this.reverb = ctx.createConvolver();
      const rl = Math.floor(ctx.sampleRate * 1.6);
      const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < rl; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2);
      }
      this.reverb.buffer = ir;
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.22;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.comp);
      this.applyMute();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      this.loadSamples();
    } catch {
      this.ctx = null;
    }
  }

  /** Kenney MIT-licensed one-shots, layered on top of the synth sounds. */
  private loadSamples() {
    const base = import.meta.env.BASE_URL + 'sfx/';
    for (const n of ['blaster', 'enemy_destroy', 'enemy_hurt', 'enemy_attack', 'weapon_change', 'coin', 'break', 'impact']) {
      fetch(base + n + '.mp3')
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx!.decodeAudioData(b))
        .then((buf) => this.samples.set(n, buf))
        .catch(() => {});
    }
  }

  private sample(name: string, vol: number, rate = 1, maxDur = 0, t?: number) {
    const buf = this.samples.get(name);
    if (!buf || !this.ctx) return false;
    const ctx = this.ctx;
    const at = t ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    if (maxDur > 0) {
      g.gain.setValueAtTime(vol, at + maxDur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, at + maxDur);
    }
    src.connect(g);
    g.connect(this.sfxBus);
    src.start(at);
    src.stop(at + (maxDur > 0 ? maxDur + 0.05 : buf.duration / rate + 0.05));
    return true;
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.ctx) return;
    this.sfxBus.gain.value = sfx;
    this.musicBus.gain.value = music * 0.55;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.applyMute();
    return this.muted;
  }
  private applyMute() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.02);
  }

  /* ---------- primitives ---------- */
  private osc(f: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, f2?: number, attack = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }
  private nz(t: number, dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', dest?: AudioNode, sweepTo?: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest ?? this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
    return g;
  }

  sfx(name: Sfx, p = 0) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const gaps: Partial<Record<Sfx, number>> = { shoot: 0.055, hit: 0.03, pick: 0.02, kill: 0.035, zap: 0.06, boom: 0.06, missile: 0.08, spawn: 0.25 };
    const gap = gaps[name] ?? 0;
    if (now - (this.last[name] ?? 0) < gap) return;
    this.last[name] = now;
    const B = this.sfxBus;
    switch (name) {
      case 'shoot':
        if (!this.sample('blaster', 0.16, 1.15 + Math.random() * 0.2, 0.22)) this.osc(1500 + Math.random() * 200, now, 0.07, 'square', 0.035, B, 500);
        this.osc(3000, now, 0.03, 'sine', 0.012, B, 1200);
        break;
      case 'hit':
        if (!this.sample('enemy_hurt', 0.18, 0.9 + Math.random() * 0.3)) this.osc(240 + Math.random() * 60, now, 0.05, 'triangle', 0.05, B, 110);
        break;
      case 'kill':
        this.sample('enemy_destroy', 0.22, 0.85 + Math.random() * 0.35, 0.5);
        this.nz(now, 0.16, 0.08, 2200, 'lowpass', B, 300);
        this.osc(320 + Math.random() * 80, now, 0.12, 'square', 0.04, B, 70);
        break;
      case 'pick': {
        const f = 700 + Math.min(p, 30) * 35;
        if (!this.sample('coin', 0.12, 1 + Math.min(p, 24) * 0.04)) this.osc(f, now, 0.08, 'sine', 0.07, B, f * 1.5);
        break;
      }
      case 'level':
        [0, 4, 7, 12, 16, 19].forEach((s, i) => {
          const g = this.osc(mtof(72 + s), now + i * 0.055, 0.25, 'square', 0.05, B);
          g.connect(this.reverbSend);
        });
        break;
      case 'evolve':
        [0, 7, 12, 16, 19, 24, 28].forEach((s, i) => {
          const g = this.osc(mtof(64 + s), now + i * 0.07, 0.5, 'sawtooth', 0.045, B);
          g.connect(this.reverbSend);
        });
        this.nz(now, 1.2, 0.08, 400, 'bandpass', B, 6000);
        break;
      case 'hurt':
        this.sample('impact', 0.5, 0.8);
        this.osc(180, now, 0.28, 'sawtooth', 0.1, B, 45);
        this.nz(now, 0.2, 0.15, 900);
        break;
      case 'zap':
        this.nz(now, 0.12, 0.09, 4000, 'highpass');
        this.osc(1800, now, 0.1, 'sawtooth', 0.03, B, 300);
        break;
      case 'boom': {
        this.sample('break', 0.3, 0.6 + Math.random() * 0.2);
        const g = this.nz(now, 0.45, 0.22, 900, 'lowpass', B, 80);
        g.connect(this.reverbSend);
        this.osc(110, now, 0.35, 'sine', 0.3, B, 32);
        break;
      }
      case 'missile':
        this.nz(now, 0.25, 0.05, 600, 'bandpass', B, 3000);
        break;
      case 'nova': {
        this.osc(70, now, 0.5, 'sine', 0.28, B, 260);
        const g = this.nz(now, 0.5, 0.12, 300, 'bandpass', B, 4000);
        g.connect(this.reverbSend);
        break;
      }
      case 'lance': {
        this.osc(90, now, 0.45, 'sawtooth', 0.09, B, 40);
        this.osc(2400, now, 0.3, 'square', 0.03, B, 600);
        this.nz(now, 0.35, 0.1, 6000, 'highpass');
        break;
      }
      case 'dash':
        this.nz(now, 0.22, 0.12, 500, 'bandpass', B, 5000);
        this.osc(300, now, 0.15, 'sine', 0.06, B, 900);
        break;
      case 'warn':
        for (let i = 0; i < 3; i++) {
          this.osc(440, now + i * 0.5, 0.22, 'sawtooth', 0.09, B, 430);
          this.osc(330, now + i * 0.5 + 0.24, 0.22, 'sawtooth', 0.09, B, 320);
        }
        break;
      case 'bossdie': {
        const g = this.nz(now, 2.2, 0.35, 1600, 'lowpass', B, 40);
        g.connect(this.reverbSend);
        this.osc(80, now, 1.6, 'sine', 0.4, B, 20);
        [0, 3, 7, 12].forEach((s, i) => this.osc(mtof(60 + s), now + 0.3 + i * 0.12, 0.6, 'square', 0.04, B));
        break;
      }
      case 'bomb': {
        const g = this.nz(now, 1.4, 0.35, 3000, 'lowpass', B, 60);
        g.connect(this.reverbSend);
        this.osc(60, now, 1, 'sine', 0.4, B, 25);
        break;
      }
      case 'heal':
        [0, 5, 9, 12].forEach((s, i) => this.osc(mtof(76 + s), now + i * 0.05, 0.18, 'sine', 0.06, B));
        break;
      case 'select':
        this.sample('weapon_change', 0.35, 1.1);
        this.osc(880, now, 0.08, 'square', 0.05, B, 1320);
        this.osc(1320, now + 0.06, 0.12, 'square', 0.04, B, 1760);
        break;
      case 'click':
        this.osc(1200, now, 0.04, 'square', 0.03, B, 900);
        break;
      case 'victory': {
        const seq = [0, 4, 7, 12, 7, 12, 16, 19, 24];
        seq.forEach((n, i) => {
          const g = this.osc(mtof(60 + n), now + i * 0.11, i === seq.length - 1 ? 1.6 : 0.3, 'sawtooth', 0.05, B);
          g.connect(this.reverbSend);
          this.osc(mtof(48 + n), now + i * 0.11, 0.3, 'square', 0.03, B);
        });
        this.nz(now + 0.9, 1.5, 0.06, 6000, 'highpass');
        break;
      }
      case 'heart':
        this.osc(62, now, 0.16, 'sine', 0.35, B, 40);
        this.osc(58, now + 0.2, 0.18, 'sine', 0.28, B, 38);
        break;
      case 'spawn':
        this.osc(200, now, 0.4, 'sine', 0.05, B, 600);
        break;
    }
  }

  /* ---------- music ---------- */
  startMusic() {
    if (!this.ctx || this.timer !== null) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stopMusic() {
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  resetMusic() {
    this.step = 0;
  }

  private schedule() {
    if (!this.ctx || !this.playing) return;
    const spb = 60 / this.bpm() / 4; // 16th notes
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      if (!this.muted && this.musicOn) this.playStep(this.step, this.nextTime);
      this.nextTime += spb;
      this.step++;
    }
  }

  // A minor progression: Am – F – C – G (with E for tension at high intensity)
  /** 'dusk' = A minor synthwave, 'night' = slower E minor, boss = driving D minor */
  theme: 'dusk' | 'night' = 'dusk';
  private progs: Record<string, [number, number[]][]> = {
    dusk: [[45, [0, 3, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [43, [0, 4, 7]]],
    night: [[40, [0, 3, 7]], [36, [0, 4, 7]], [43, [0, 4, 7]], [38, [0, 4, 7]]],
    boss: [[38, [0, 3, 7]], [46, [0, 4, 7]], [48, [0, 4, 7]], [45, [0, 4, 7, 10]]],
  };
  private curProg = 'dusk';
  private get chords() {
    return this.progs[this.curProg];
  }
  private bpm() {
    return this.curProg === 'boss' ? 134 : this.curProg === 'night' ? 104 : 118;
  }

  private playStep(s: number, t: number) {
    const ctx = this.ctx!;
    const M = this.musicBus;
    const st = s % 16;
    if (st === 0) this.curProg = this.intensity >= 3 ? 'boss' : this.theme;
    const bar = Math.floor(s / 16) % 4;
    const [root, triad] = this.chords[bar];
    const I = this.intensity;
    // kick
    if (st % 4 === 0) {
      this.osc(140, t, 0.18, 'sine', 0.5, M, 42, 0.002);
    }
    // snare on 2/4 from intensity 1
    if (I >= 1 && (st === 4 || st === 12)) {
      this.nz(t, 0.16, 0.16, 1800, 'bandpass', M);
      this.osc(220, t, 0.08, 'triangle', 0.08, M, 160);
    }
    // hats
    if (st % 2 === 0) this.nz(t, 0.03, I >= 1 ? 0.05 : 0.03, 8000, 'highpass', M);
    if (I >= 2 && st % 2 === 1) this.nz(t, 0.02, 0.025, 9000, 'highpass', M);
    // bass: octave pulse on 8ths
    if (st % 2 === 0) {
      const n = root - 12 + (st % 4 === 2 ? 12 : 0);
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = mtof(n);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(380 + I * 260, t);
      f.frequency.exponentialRampToValueAtTime(140, t + 0.18);
      f.Q.value = 7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(f);
      f.connect(g);
      g.connect(M);
      o.start(t);
      o.stop(t + 0.25);
    }
    // pad on bar start
    if (st === 0) {
      for (const iv of triad) {
        const g = this.osc(mtof(root + 12 + iv), t, 2.0, 'sawtooth', 0.018, M, undefined, 0.4);
        g.connect(this.reverbSend);
      }
    }
    // arpeggio from intensity 1
    if (I >= 1 && st % 2 === 1) {
      const seq = [0, 1, 2, 1, 2, 0, 2, 1];
      const iv = triad[seq[(st >> 1) % 8]] + ((st >> 3) % 2 ? 12 : 0);
      const g = this.osc(mtof(root + 24 + iv), t, 0.14, 'square', 0.022, M);
      g.connect(this.reverbSend);
    }
    // lead stabs during boss
    if (I >= 3 && (st === 0 || st === 3 || st === 6 || st === 10)) {
      const g = this.osc(mtof(root + 36 + triad[(st / 3) % 3 | 0]), t, 0.2, 'sawtooth', 0.03, M);
      g.connect(this.reverbSend);
    }
  }
}
