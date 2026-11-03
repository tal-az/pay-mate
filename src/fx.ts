// Small game-feel helpers for the mapping screen: confetti particles and tiny synthesized sounds.

export interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  rot: number;
  size: number;
  color: string;
  round: boolean;
}

let nextId = 1;

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Particles flying out of a point; `power` scales count and distance. */
export function burst(x: number, y: number, colors: string[], power = 1): Particle[] {
  if (reducedMotion()) return [];
  const count = Math.round(14 * power);
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const dist = (70 + Math.random() * 120) * Math.min(power, 2);
    return {
      id: nextId++,
      x,
      y,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 60,
      rot: Math.random() * 720 - 360,
      size: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.35,
    };
  });
}

/** Confetti raining from the top of the viewport. */
export function shower(colors: string[], count = 90): Particle[] {
  if (reducedMotion()) return [];
  return Array.from({ length: count }, () => ({
    id: nextId++,
    x: Math.random() * window.innerWidth,
    y: -20,
    dx: Math.random() * 160 - 80,
    dy: window.innerHeight * (0.6 + Math.random() * 0.5),
    rot: Math.random() * 900 - 450,
    size: 7 + Math.random() * 7,
    color: colors[Math.floor(Math.random() * colors.length)],
    round: Math.random() < 0.3,
  }));
}

let ctx: AudioContext | null = null;

/** A short blip; pitch climbs with the streak. Silent if audio is unavailable. */
export function blip(step: number, kind: 'pick' | 'undo' | 'win' = 'pick') {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const notes = kind === 'win' ? [523, 659, 784, 1047] : [kind === 'undo' ? 330 : 440 * 2 ** ((Math.min(step, 12) / 12) * 1.5)];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.09;
      osc.type = kind === 'undo' ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch {
    /* no audio */
  }
}
