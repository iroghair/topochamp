// Short feedback sounds made with Web Audio (no sound files needed).

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', volume = 0.15): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function ready(): boolean {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export function playCorrect(streak = 1): void {
  if (!ready()) return;
  const lift = Math.min(streak, 8) * 20;
  tone(660 + lift, 0, 0.15, 'triangle');
  tone(880 + lift, 0.1, 0.25, 'triangle');
}

export function playAlmost(): void {
  if (!ready()) return;
  tone(520, 0, 0.18, 'triangle');
}

export function playWrong(): void {
  if (!ready()) return;
  tone(240, 0, 0.25, 'sawtooth', 0.08);
  tone(180, 0.15, 0.3, 'sawtooth', 0.08);
}

export function playFanfare(): void {
  if (!ready()) return;
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle'));
}
