import '@fontsource/orbitron/latin-500.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/orbitron/latin-900.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import './style.css';
import './ui/i18n'; // must run before game modules read the data tables
import { Assets } from './core/Assets';
import { Renderer } from './core/Renderer';
import { Game } from './game/Game';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  const assets = new Assets();

  // the loading screen is part of the UI template; show a minimal one until the UI exists
  const pre = document.getElementById('preload');
  const fill = document.getElementById('preFill');
  await assets.load(renderer.renderer, (p) => {
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
  });
  const game = new Game(canvas, assets, renderer);
  (window as unknown as { prismfall: Game }).prismfall = game;
  pre?.classList.add('fade');
  setTimeout(() => pre?.remove(), 700);
  game.ui.loaded();

  // offer "install as app" on desktop browsers that support it
  let deferred: (Event & { prompt: () => Promise<void> }) | null = null;
  const btn = document.getElementById('installBtn');
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as Event & { prompt: () => Promise<void> };
    btn?.classList.remove('hidden');
  });
  btn?.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt().catch(() => {});
    deferred = null;
    btn.classList.add('hidden');
  });
}

boot().catch((e) => {
  console.error(e);
  const pre = document.getElementById('preload');
  if (pre) pre.innerHTML = `<div class="err">Failed to start: ${String(e?.message ?? e)}<br/>Your browser needs WebGL2 support.</div>`;
});
