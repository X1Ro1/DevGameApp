export class Sfx {
  private ctx: AudioContext | null = null;
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
  ): void {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + duration);
  }

  hit(): void {
    this.tone(520, 1100, 0.12, 'triangle', 0.18);
  }

  miss(): void {
    this.tone(180, 90, 0.22, 'sawtooth', 0.12);
  }

  win(): void {
    this.tone(392, 392, 0.2, 'sine', 0.16);
    window.setTimeout(() => this.tone(523, 523, 0.2, 'sine', 0.16), 140);
    window.setTimeout(() => this.tone(659, 659, 0.45, 'sine', 0.16), 280);
  }

  lose(): void {
    this.tone(300, 70, 0.7, 'sawtooth', 0.14);
  }
}
