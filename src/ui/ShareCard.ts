import { fmtNum, fmtTime } from '../core/util';

export interface CardData {
  snap: HTMLCanvasElement | null;
  victory: boolean;
  score: number;
  time: number;
  level: number;
  kills: number;
  bosses: number;
  ship: string;
  sector: string;
  mods: string[];
}

/** Render a 1200x630 run summary image (social-card size). */
export function renderShareCard(d: CardData): HTMLCanvasElement {
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0610';
  g.fillRect(0, 0, W, H);
  if (d.snap) {
    const s = d.snap;
    const k = Math.max(W / s.width, H / s.height);
    g.drawImage(s, (W - s.width * k) / 2, (H - s.height * k) / 2, s.width * k, s.height * k);
  }
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(11,6,16,0.92)');
  grad.addColorStop(0.55, 'rgba(11,6,16,0.6)');
  grad.addColorStop(1, 'rgba(11,6,16,0.1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const disp = "900 64px Orbitron, 'Segoe UI', sans-serif";
  const lg = g.createLinearGradient(60, 0, 560, 0);
  lg.addColorStop(0, '#ffffff');
  lg.addColorStop(0.4, '#5ef2ff');
  lg.addColorStop(0.7, '#b48bff');
  lg.addColorStop(1, '#ff4fd8');
  g.font = disp;
  g.fillStyle = lg;
  g.shadowColor = 'rgba(94,242,255,0.6)';
  g.shadowBlur = 24;
  g.fillText('PRISMFALL', 60, 110);
  g.shadowBlur = 0;

  g.font = "700 22px Orbitron, sans-serif";
  g.fillStyle = d.victory ? '#7ff6ff' : '#ff8aa0';
  g.fillText(d.victory ? 'COLONY SAVED' : 'SIGNAL LOST', 62, 160);

  g.font = "600 18px Rajdhani, sans-serif";
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText(`${d.ship} · ${d.sector}${d.mods.length ? ' · ' + d.mods.join(', ') : ''}`, 62, 192);

  g.font = "700 16px Orbitron, sans-serif";
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText('SCORE', 62, 262);
  g.font = "900 84px Orbitron, sans-serif";
  g.fillStyle = '#ffd84f';
  g.shadowColor = 'rgba(255,216,79,0.5)';
  g.shadowBlur = 20;
  g.fillText(fmtNum(d.score), 58, 345);
  g.shadowBlur = 0;

  const stats: [string, string][] = [
    ['SURVIVED', fmtTime(d.time)],
    ['LEVEL', String(d.level)],
    ['KILLS', fmtNum(d.kills)],
    ['BOSSES', String(d.bosses)],
  ];
  stats.forEach(([k, v], i) => {
    const x = 62 + i * 165;
    g.font = "700 13px Orbitron, sans-serif";
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText(k, x, 410);
    g.font = "900 32px Orbitron, sans-serif";
    g.fillStyle = '#ffffff';
    g.fillText(v, x, 450);
  });

  g.font = "600 18px Rajdhani, sans-serif";
  g.fillStyle = 'rgba(94,242,255,0.85)';
  g.fillText('youssefshaaban07.github.io/prismfall', 62, H - 50);
  return c;
}
