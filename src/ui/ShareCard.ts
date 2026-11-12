import { t } from './i18n';
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
  /** transparent studio render of the ship, drawn as the card's hero */
  portrait?: HTMLCanvasElement | null;
  accent?: string;
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

  if (d.portrait) {
    // hero ship on the right: a coloured halo, a soft floor shadow, then the render itself
    const cx = 900, cy = 300, R = 270;
    const halo = g.createRadialGradient(cx, cy, 10, cx, cy, R);
    halo.addColorStop(0, (d.accent ?? '#5ef2ff') + '66');
    halo.addColorStop(0.5, (d.accent ?? '#5ef2ff') + '22');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(cx, cy + 190, 200, 26, 0, 0, Math.PI * 2);
    g.filter = 'blur(14px)';
    g.fill();
    g.restore();
    g.save();
    g.shadowColor = d.accent ?? '#5ef2ff';
    g.shadowBlur = 40;
    g.drawImage(d.portrait, cx - 300, cy - 300, 600, 600);
    g.restore();
  }

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

  g.font = "700 22px Orbitron, Cairo, sans-serif";
  g.fillStyle = d.victory ? '#7ff6ff' : '#ff8aa0';
  g.fillText(t(d.victory ? 'COLONY SAVED' : 'SIGNAL LOST'), 62, 160);

  g.font = "600 18px Rajdhani, Cairo, sans-serif";
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText(`${d.ship} · ${t(d.sector)}${d.mods.length ? ' · ' + d.mods.join(', ') : ''}`, 62, 192);

  g.font = "700 16px Orbitron, Cairo, sans-serif";
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillText(t('SCORE'), 62, 262);
  g.font = "900 84px Orbitron, Cairo, sans-serif";
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
    g.font = "700 13px Orbitron, Cairo, sans-serif";
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillText(t(k), x, 410);
    g.font = "900 32px Orbitron, Cairo, sans-serif";
    g.fillStyle = '#ffffff';
    g.fillText(v, x, 450);
  });

  g.font = "600 18px Rajdhani, Cairo, sans-serif";
  g.fillStyle = 'rgba(94,242,255,0.85)';
  g.fillText('youssefshaaban07.github.io/prismfall', 62, H - 50);
  return c;
}
