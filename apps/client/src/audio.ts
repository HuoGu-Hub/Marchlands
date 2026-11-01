type Wave = OscillatorType;

class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;

  unlock(): void {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume * 0.32;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume / 100));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume * 0.32, this.context.currentTime, 0.03);
    }
  }

  click(): void {
    this.tone(720, 0.05, "sine", 0, 0.05);
  }

  send(): void {
    this.tone(240, 0.12, "triangle", 0, 0.07, 330);
  }

  upgrade(): void {
    this.tone(440, 0.1, "triangle", 0, 0.06, 660);
  }

  capture(): void {
    this.tone(523, 0.1, "sine", 0, 0.07);
    this.tone(659, 0.1, "sine", 0.07, 0.07);
    this.tone(784, 0.16, "sine", 0.14, 0.07);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((frequency, index) => this.tone(frequency, 0.24, "triangle", index * 0.12, 0.08));
  }

  lostCity(): void {
    this.tone(196, 0.18, "sine", 0, 0.06, 150);
  }

  lose(): void {
    [330, 262, 196].forEach((frequency, index) => this.tone(frequency, 0.3, "sine", index * 0.16, 0.07));
  }

  private tone(
    frequency: number,
    duration: number,
    wave: Wave,
    delay = 0,
    volume = 0.07,
    endFrequency?: number,
  ): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.linearRampToValueAtTime(endFrequency, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}

export const audio = new GameAudio();
