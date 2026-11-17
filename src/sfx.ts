export class Sfx {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    attack = 0.01,
  ): void {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  /** Короткий шумовой всплеск (взрыв). */
  private noise(duration: number, volume: number, cutoff: number): void {
    if (this.muted || !this.ctx) return;
    if (!this.noiseBuf) {
      const len = Math.floor(this.ctx.sampleRate);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + duration);
  }

  private buzzOsc: OscillatorNode | null = null;
  private buzzGain: GainNode | null = null;
  /** Непрерывное жужжание: громче, когда комар рядом (intensity 0..1), ниже при заморозке. */
  buzz(intensity: number, slow: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.buzzOsc || !this.buzzGain) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 230;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 38;
      const lg = ctx.createGain();
      lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 650;
      const g = ctx.createGain();
      g.gain.value = 0;
      o.connect(f).connect(g).connect(ctx.destination);
      o.start();
      lfo.start();
      this.buzzOsc = o;
      this.buzzGain = g;
    }
    const t = ctx.currentTime;
    this.buzzGain.gain.setTargetAtTime(this.muted ? 0 : 0.004 + 0.03 * intensity, t, 0.1);
    this.buzzOsc.frequency.setTargetAtTime(slow ? 140 : 220 + intensity * 70, t, 0.08);
  }
  buzzStop(): void {
    if (this.buzzGain && this.ctx) this.buzzGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
  hit(): void {
    this.tone(520, 1100, 0.12, 'triangle', 0.18);
  }

  miss(): void {
    this.tone(180, 90, 0.22, 'sawtooth', 0.12);
  }

  lose(): void {
    this.tone(300, 70, 0.7, 'sawtooth', 0.14);
  }

  /** Попадание по комару, который пока не погиб. */
  wound(): void {
    this.tone(760, 320, 0.11, 'square', 0.09);
  }

  /** Комары переходят во вторую фазу. */
  phase(): void {
    this.tone(110, 440, 0.5, 'sawtooth', 0.14);
    window.setTimeout(() => this.tone(165, 660, 0.45, 'sawtooth', 0.12), 180);
  }

  pause(): void {
    this.tone(520, 340, 0.12, 'sine', 0.12);
  }

  resume(): void {
    this.tone(340, 520, 0.12, 'sine', 0.12);
  }

  /** Появление особого комара. */
  spawn(): void {
    this.tone(180, 520, 0.3, 'triangle', 0.07);
  }

  /** Ледяной комар убит — морозная волна. */
  freeze(): void {
    this.tone(1500, 620, 0.3, 'sine', 0.09);
    window.setTimeout(() => this.tone(1900, 760, 0.28, 'sine', 0.07), 70);
    window.setTimeout(() => this.tone(2400, 980, 0.25, 'sine', 0.05), 140);
  }

  /** Комар-бомба взорвался. */
  boom(): void {
    this.tone(160, 42, 0.5, 'sawtooth', 0.2);
    this.tone(80, 32, 0.6, 'sine', 0.22);
    this.noise(0.35, 0.3, 500);
  }

  /** Нота победной последовательности (пентатоника). */
  chime(step: number): void {
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.7, 1318.5];
    const f = scale[step % scale.length];
    this.tone(f, f, 0.6, 'sine', 0.11, 0.005);
    this.tone(f * 2, f * 2, 0.3, 'sine', 0.04, 0.005);
  }

  /** Тёплый аккорд, когда над комнатой восходит луна. */
  moon(): void {
    const chord = [261.63, 329.63, 392.0, 523.25];
    chord.forEach((f, i) => {
      window.setTimeout(() => this.tone(f, f, 2.4, 'sine', 0.07, 0.5), i * 130);
    });
  }
}
