import type { CardView } from '../game/Upgrades';
import { fmtNum, fmtTime } from '../core/util';
import { PASSIVES, WEAPONS, FINAL_TIME, ARENA_RADIUS, type PassiveId, type WeaponId } from '../game/data';
import type { Quality } from '../core/Renderer';

export interface Settings {
  quality: Quality;
  sfx: number;
  music: number;
  shake: boolean;
  numbers: boolean;
}

export interface HudState {
  hp: number; maxHp: number; xp: number; xpNext: number; level: number; time: number; kills: number; score: number;
  combo: number; dashFrac: number; won: boolean; endless: boolean;
  weapons: Map<WeaponId, number>; passives: Map<PassiveId, number>; evolved: Set<WeaponId>;
}

export interface MinimapData {
  px: number; pz: number; ang: number;
  enemies: { x: number; z: number; boss: boolean; elite: boolean }[];
  powers: { x: number; z: number }[];
}

export interface RunStats {
  victory: boolean; time: number; level: number; kills: number; score: number; maxCombo: number; bosses: number;
  best: number; newBest: boolean; damage: number; weapons: Map<WeaponId, number>; evolved: Set<WeaponId>;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export class UI {
  root: HTMLElement;
  hud!: HTMLElement;
  joy!: HTMLElement;
  knob!: HTMLElement;
  dashBtn!: HTMLElement;
  floaters!: HTMLElement;
  private mm!: CanvasRenderingContext2D;
  private lastHud = '';
  private lastSlots = '';
  private bannerTimer = 0;
  private cardsLocked = 0;
  private onPick: ((i: number) => void) | null = null;
  private onReroll: (() => void) | null = null;

  onPlay: () => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onRetry: () => void = () => {};
  onEndless: () => void = () => {};
  onSettings: (s: Settings) => void = () => {};
  onClick: () => void = () => {};

  constructor(public settings: Settings) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = TEMPLATE;
    this.hud = $('#hud');
    this.joy = $('#joy');
    this.knob = $('#joy .knob');
    this.dashBtn = $('#dashBtn');
    this.floaters = $('#floaters');
    this.mm = ($('#minimap') as HTMLCanvasElement).getContext('2d')!;

    $('#playBtn').addEventListener('click', () => this.onPlay());
    $('#resumeBtn').addEventListener('click', () => this.onResume());
    $('#quitBtn').addEventListener('click', () => this.onQuit());
    $('#retryBtn').addEventListener('click', () => this.onRetry());
    $('#menuBtn').addEventListener('click', () => this.onQuit());
    $('#endlessBtn').addEventListener('click', () => this.onEndless());
    $('#pauseBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.onResume(); // toggles via game
    });
    $('#rerollBtn').addEventListener('click', () => this.onReroll?.());
    $('#howBtn').addEventListener('click', () => this.show('#how'));
    $('#howClose').addEventListener('click', () => this.hide('#how'));
    $('#creditsBtn').addEventListener('click', () => this.show('#credits'));
    $('#creditsClose').addEventListener('click', () => this.hide('#credits'));
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.onClick();
    });
    this.bindSettings();
  }

  /* ---------- generic ---------- */
  show(sel: string) {
    $(sel).classList.remove('hidden');
  }
  hide(sel: string) {
    $(sel).classList.add('hidden');
  }

  loaded() {
    /* preload screen lives in index.html */
  }

  showMenu(best: number, bestTime: number, touch: boolean) {
    this.hideAll();
    this.show('#menu');
    $('#bestTxt').innerHTML = best > 0 ? `BEST <b>${fmtNum(best)}</b> &nbsp;·&nbsp; LONGEST <b>${fmtTime(bestTime)}</b>` : 'No runs yet. The colony is counting on you.';
    $('#ctlHint').textContent = touch ? 'Drag anywhere to fly · Tap DASH to dodge' : 'WASD / Arrows to fly · SPACE to dash · ESC to pause · Gamepad supported';
  }

  hideAll() {
    for (const s of ['#menu', '#levelup', '#pause', '#over', '#how', '#credits']) this.hide(s);
  }

  startRun(touch: boolean) {
    this.hideAll();
    this.hud.classList.remove('hidden');
    this.dashBtn.classList.toggle('hidden', !touch);
    $('#dashHint').classList.toggle('hidden', touch);
    this.lastHud = '';
    this.lastSlots = '';
    this.setBoss(null, 0);
  }

  hideHud() {
    this.hud.classList.add('hidden');
  }

  /* ---------- HUD ---------- */
  updateHud(s: HudState) {
    ($('#hpFill') as HTMLElement).style.width = `${Math.max(0, (s.hp / s.maxHp) * 100)}%`;
    ($('#xpFill') as HTMLElement).style.width = `${Math.min(100, (s.xp / s.xpNext) * 100)}%`;
    const low = s.hp / s.maxHp < 0.3;
    $('#hpbar').classList.toggle('low', low);
    document.body.classList.toggle('lowhp', low);
    const key = `${Math.ceil(s.hp)}|${Math.ceil(s.maxHp)}|${s.level}|${Math.floor(s.time)}|${s.kills}|${Math.floor(s.score)}|${s.won}`;
    if (key !== this.lastHud) {
      this.lastHud = key;
      $('#hpTxt').textContent = `${Math.ceil(Math.max(0, s.hp))} / ${Math.ceil(s.maxHp)}`;
      $('#lvTxt').textContent = `LV ${s.level}`;
      $('#timer').textContent = fmtTime(s.time);
      $('#kills').textContent = `${fmtNum(s.kills)} KILLS`;
      $('#score').textContent = fmtNum(s.score);
      const left = FINAL_TIME - s.time;
      $('#goal').textContent = s.endless ? 'ENDLESS MODE' : s.won ? 'CORE DESTROYED' : left > 0 ? `CORE ARRIVES IN ${fmtTime(left)}` : 'DESTROY THE CORE';
    }
    const ring = $('#dashRing') as HTMLElement;
    ring.style.setProperty('--p', `${Math.round(s.dashFrac * 100)}`);
    this.dashBtn.classList.toggle('ready', s.dashFrac >= 1);
    const dh = $('#dashHint');
    dh.classList.toggle('ready', s.dashFrac >= 1);
    const combo = $('#combo');
    if (s.combo >= 10) {
      combo.textContent = `${s.combo}× COMBO`;
      combo.classList.add('on');
      combo.style.setProperty('--s', String(1 + Math.min(0.6, s.combo / 300)));
    } else combo.classList.remove('on');

    const slotsKey = [...s.weapons].map(([k, v]) => k + v + (s.evolved.has(k) ? 'E' : '')).join() + '|' + [...s.passives].map(([k, v]) => k + v).join();
    if (slotsKey !== this.lastSlots) {
      this.lastSlots = slotsKey;
      const w = [...s.weapons].map(([id, lv]) => slot(WEAPONS[id].icon, WEAPONS[id].color, s.evolved.has(id) ? 6 : lv, s.evolved.has(id))).join('');
      const p = [...s.passives].map(([id, lv]) => slot(PASSIVES[id].icon, PASSIVES[id].color, lv, false, true)).join('');
      $('#slots').innerHTML = `<div class="row">${w}</div><div class="row">${p}</div>`;
    }
  }

  minimap(d: MinimapData) {
    const c = this.mm;
    const W = c.canvas.width;
    const R = W / 2 - 4;
    const k = R / ARENA_RADIUS;
    c.clearRect(0, 0, W, W);
    c.save();
    c.translate(W / 2, W / 2);
    c.fillStyle = 'rgba(8,4,16,0.55)';
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(94,242,255,0.6)';
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = 'rgba(94,242,255,0.12)';
    c.beginPath();
    c.arc(0, 0, R * 0.5, 0, Math.PI * 2);
    c.stroke();
    for (const e of d.enemies) {
      if (e.boss) continue;
      c.fillStyle = e.elite ? '#ffd84f' : '#ff3f8f';
      c.fillRect(e.x * k - 1, e.z * k - 1, 2, 2);
    }
    for (const p of d.powers) {
      c.fillStyle = '#7dff9b';
      c.beginPath();
      c.arc(p.x * k, p.z * k, 2.5, 0, Math.PI * 2);
      c.fill();
    }
    for (const e of d.enemies) {
      if (!e.boss) continue;
      c.fillStyle = '#c86bff';
      c.shadowColor = '#c86bff';
      c.shadowBlur = 8;
      c.beginPath();
      c.arc(e.x * k, e.z * k, 5, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
    c.translate(d.px * k, d.pz * k);
    c.rotate(-d.ang + Math.PI);
    c.fillStyle = '#5ef2ff';
    c.beginPath();
    c.moveTo(0, -5);
    c.lineTo(3.5, 4);
    c.lineTo(-3.5, 4);
    c.closePath();
    c.fill();
    c.restore();
  }

  setBoss(name: string | null, frac: number) {
    const bb = $('#bossBar');
    if (!name) {
      bb.classList.add('hidden');
      return;
    }
    bb.classList.remove('hidden');
    $('#bossName').textContent = name;
    ($('#bossFill') as HTMLElement).style.width = `${Math.max(0, frac * 100)}%`;
  }

  banner(title: string, sub: string, color = '#5ef2ff', dur = 2600) {
    const b = $('#banner');
    $('.b1', b).textContent = title;
    $('.b2', b).textContent = sub;
    b.style.setProperty('--c', color);
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('on'), dur);
  }

  flash(color = 'rgba(255,255,255,0.7)') {
    const f = $('#flash');
    f.style.background = color;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  /* ---------- level up ---------- */
  showLevelUp(level: number, cards: CardView[], rerolls: number, onPick: (i: number) => void, onReroll: () => void) {
    this.onPick = onPick;
    this.onReroll = onReroll;
    $('#lvlNum').textContent = String(level);
    const wrap = $('#cards');
    wrap.innerHTML = cards
      .map(
        (c, i) => `
      <button class="card ${c.special ?? ''}" style="--c:${c.color};--d:${i * 70}ms" data-i="${i}">
        <div class="key">${i + 1}</div>
        <div class="ic"><span>${c.icon}</span></div>
        <div class="txt">
          <div class="tag">${c.tag}</div>
          <div class="nm">${c.name}</div>
          <div class="ds">${c.desc}</div>
          ${c.max ? `<div class="pips">${Array.from({ length: c.max }, (_, k) => `<i class="${k < c.level ? 'on' : ''}"></i>`).join('')}</div>` : ''}
        </div>
      </button>`,
      )
      .join('');
    wrap.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      el.addEventListener('click', () => this.pick(Number(el.dataset.i)));
    });
    const rb = $('#rerollBtn');
    rb.textContent = `↻ REROLL (${rerolls})`;
    rb.toggleAttribute('disabled', rerolls <= 0);
    this.show('#levelup');
    // brief lockout so a held drag/tap doesn't instantly pick a card
    this.cardsLocked = performance.now() + 450;
    wrap.classList.add('locked');
    setTimeout(() => wrap.classList.remove('locked'), 450);
  }

  pick(i: number) {
    if (performance.now() < this.cardsLocked || !this.onPick) return;
    const cards = $('#cards').querySelectorAll('.card');
    if (i < 0 || i >= cards.length) return;
    const cb = this.onPick;
    this.onPick = null;
    cards[i].classList.add('chosen');
    setTimeout(() => {
      this.hide('#levelup');
      cb(i);
    }, 220);
  }

  reroll() {
    this.onReroll?.();
  }

  levelUpOpen() {
    return !$('#levelup').classList.contains('hidden');
  }

  /* ---------- pause ---------- */
  showPause(weapons: Map<WeaponId, number>, passives: Map<PassiveId, number>, evolved: Set<WeaponId>) {
    const w = [...weapons].map(([id, lv]) => `<div class="bi" style="--c:${WEAPONS[id].color}"><span>${WEAPONS[id].icon}</span><b>${evolved.has(id) ? WEAPONS[id].evoName : WEAPONS[id].name}</b><em>${evolved.has(id) ? 'EVO' : 'LV ' + lv}</em></div>`).join('');
    const p = [...passives].map(([id, lv]) => `<div class="bi" style="--c:${PASSIVES[id].color}"><span>${PASSIVES[id].icon}</span><b>${PASSIVES[id].name}</b><em>LV ${lv}</em></div>`).join('');
    $('#build').innerHTML = w + p;
    this.show('#pause');
  }
  hidePause() {
    this.hide('#pause');
  }

  private bindSettings() {
    const s = this.settings;
    const q = document.querySelectorAll<HTMLButtonElement>('.qbtn');
    const sync = () => {
      q.forEach((b) => b.classList.toggle('on', b.dataset.q === s.quality));
      ($('#sfxVol') as HTMLInputElement).value = String(s.sfx);
      ($('#musVol') as HTMLInputElement).value = String(s.music);
      ($('#shakeChk') as HTMLInputElement).checked = s.shake;
      ($('#numChk') as HTMLInputElement).checked = s.numbers;
    };
    q.forEach((b) =>
      b.addEventListener('click', () => {
        s.quality = b.dataset.q as Quality;
        sync();
        this.onSettings(s);
      }),
    );
    $('#sfxVol').addEventListener('input', (e) => {
      s.sfx = Number((e.target as HTMLInputElement).value);
      this.onSettings(s);
    });
    $('#musVol').addEventListener('input', (e) => {
      s.music = Number((e.target as HTMLInputElement).value);
      this.onSettings(s);
    });
    $('#shakeChk').addEventListener('change', (e) => {
      s.shake = (e.target as HTMLInputElement).checked;
      this.onSettings(s);
    });
    $('#numChk').addEventListener('change', (e) => {
      s.numbers = (e.target as HTMLInputElement).checked;
      this.onSettings(s);
    });
    sync();
  }

  /* ---------- game over ---------- */
  showOver(st: RunStats) {
    this.hud.classList.add('hidden');
    $('#overTitle').textContent = st.victory ? 'COLONY SAVED' : 'SIGNAL LOST';
    $('#overSub').textContent = st.victory ? 'The Prism Core is shattered. Mars breathes again.' : 'Your ship went down. The swarm advances.';
    $('#over').classList.toggle('win', st.victory);
    const ev = [...st.weapons].map(([id, lv]) => `<span style="color:${WEAPONS[id].color}">${WEAPONS[id].icon} ${st.evolved.has(id) ? WEAPONS[id].evoName : WEAPONS[id].name + ' ' + lv}</span>`).join('');
    $('#stats').innerHTML = `
      <div class="st big"><label>SCORE</label><b>${fmtNum(st.score)}</b>${st.newBest ? '<em>NEW BEST</em>' : ''}</div>
      <div class="st"><label>SURVIVED</label><b>${fmtTime(st.time)}</b></div>
      <div class="st"><label>LEVEL</label><b>${st.level}</b></div>
      <div class="st"><label>KILLS</label><b>${fmtNum(st.kills)}</b></div>
      <div class="st"><label>MAX COMBO</label><b>${fmtNum(st.maxCombo)}</b></div>
      <div class="st"><label>BOSSES</label><b>${st.bosses}</b></div>
      <div class="st"><label>DAMAGE</label><b>${fmtNum(st.damage)}</b></div>
      <div class="loadout">${ev}</div>`;
    $('#endlessBtn').classList.toggle('hidden', !st.victory);
    this.show('#over');
  }
}

function slot(icon: string, color: string, lv: number, evo: boolean, passive = false) {
  return `<div class="slot ${evo ? 'evo' : ''} ${passive ? 'pas' : ''}" style="--c:${color}"><span>${icon}</span><i>${evo ? '★' : lv}</i></div>`;
}

const TEMPLATE = /* html */ `
<div id="flash"></div>
<div id="floaters"></div>

<div id="hud" class="hidden">
  <div class="xpbar"><div id="xpFill"></div></div>
  <div class="top">
    <div class="left">
      <div class="lvrow"><div id="lvTxt" class="lv">LV 1</div>
        <div id="hpbar" class="hpbar"><div id="hpFill"></div><span id="hpTxt">100</span></div></div>
      <div id="slots" class="slots"></div>
    </div>
    <div class="center"><div id="timer" class="timer">00:00</div><div id="goal" class="goal"></div></div>
    <div class="right">
      <div class="scorebox"><div id="score" class="score">0</div><div id="kills" class="kills">0 KILLS</div></div>
      <button id="pauseBtn" class="iconbtn" aria-label="Pause">❚❚</button>
    </div>
  </div>
  <canvas id="minimap" width="150" height="150"></canvas>
  <div id="combo" class="combo"></div>
  <div id="bossBar" class="bossbar hidden"><div id="bossName" class="bossname"></div><div class="bosstrack"><div id="bossFill"></div></div></div>
  <div id="banner" class="banner"><div class="b1"></div><div class="b2"></div></div>
  <div id="joy" class="joy"><div class="knob"></div></div>
  <button id="dashBtn" class="dashbtn hidden"><div id="dashRing" class="ring"></div><span>DASH</span></button>
  <div id="dashHint" class="dashhint">SPACE · DASH</div>
</div>

<div id="menu" class="screen hidden">
  <div class="menuwrap">
    <div class="eyebrow">MARS · COLONY OUTPOST 7</div>
    <div class="logo">PRISM<span>FALL</span></div>
    <div class="tagline">A crystal swarm has fallen from the sky. Hold the line for ten minutes, then shatter the Prism Core.</div>
    <button id="playBtn" class="btn primary">LAUNCH</button>
    <div class="menurow">
      <button id="howBtn" class="btn ghost">HOW TO PLAY</button>
      <button id="creditsBtn" class="btn ghost">CREDITS</button>
    </div>
    <div id="bestTxt" class="best"></div>
    <div id="ctlHint" class="ctl"></div>
  </div>
</div>

<div id="how" class="screen modal hidden">
  <div class="panel">
    <h2>HOW TO PLAY</h2>
    <ul class="howlist">
      <li><b>Fly</b> with WASD / arrows, a gamepad stick, or drag anywhere on touch screens.</li>
      <li><b>Weapons fire automatically.</b> Focus on positioning.</li>
      <li><b>Dash</b> (Space / Shift / A button / DASH) to phase through enemies and bullets.</li>
      <li><b>Collect crystals</b> to level up and choose upgrades. Up to 5 weapons and 5 modules.</li>
      <li><b>Evolve</b> a max-level weapon by owning its paired module, e.g. Prism Blaster + Overclock.</li>
      <li><b>Bosses</b> land at 2:30, 5:00 and 7:30. The <b>Prism Core</b> arrives at 10:00. Destroy it to win.</li>
      <li>Supply drops: <span style="color:#ff5e7e">repair canister</span>, <span style="color:#4fffe0">tractor dish</span> (pulls all crystals), <span style="color:#ffaa33">payload</span> (clears the screen).</li>
    </ul>
    <div class="evos">
      ${Object.values(WEAPONS).map((w) => `<div style="--c:${w.color}"><span>${w.icon}</span> ${w.name} + ${PASSIVES[w.evoNeeds].name} → <b>${w.evoName}</b></div>`).join('')}
    </div>
    <button id="howClose" class="btn">GOT IT</button>
  </div>
</div>

<div id="credits" class="screen modal hidden">
  <div class="panel">
    <h2>CREDITS</h2>
    <p>Design, code, shaders, procedural audio: built with <b>Three.js</b>, TypeScript and Vite.</p>
    <p><b>3D models:</b> Kenney (kenney.nl), "Space Kit" (CC0) and "Starter Kit FPS" drone (MIT).</p>
    <p><b>HDR lighting:</b> Poly Haven HDRIs via pmndrs/assets (CC0).</p>
    <p><b>Normal maps:</b> pmndrs/assets (CC0).</p>
    <p><b>Fonts:</b> Orbitron and Rajdhani (SIL Open Font License).</p>
    <button id="creditsClose" class="btn">CLOSE</button>
  </div>
</div>

<div id="levelup" class="screen hidden">
  <div class="lvwrap">
    <div class="lvtitle">LEVEL <span id="lvlNum">2</span></div>
    <div class="lvsub">Choose an upgrade</div>
    <div id="cards" class="cards"></div>
    <button id="rerollBtn" class="btn ghost small">↻ REROLL</button>
  </div>
</div>

<div id="pause" class="screen hidden">
  <div class="panel wide">
    <h2>PAUSED</h2>
    <div id="build" class="build"></div>
    <div class="settings">
      <div class="set"><label>Graphics</label><div class="seg">
        <button class="qbtn" data-q="low">LOW</button><button class="qbtn" data-q="high">HIGH</button><button class="qbtn" data-q="ultra">ULTRA</button></div></div>
      <div class="set"><label>Sound FX</label><input id="sfxVol" type="range" min="0" max="1" step="0.05"></div>
      <div class="set"><label>Music</label><input id="musVol" type="range" min="0" max="1" step="0.05"></div>
      <div class="set"><label>Screen shake</label><input id="shakeChk" type="checkbox"></div>
      <div class="set"><label>Damage numbers</label><input id="numChk" type="checkbox"></div>
    </div>
    <button id="resumeBtn" class="btn primary">RESUME</button>
    <button id="quitBtn" class="btn ghost">QUIT TO MENU</button>
  </div>
</div>

<div id="over" class="screen hidden">
  <div class="panel wide">
    <div id="overTitle" class="overtitle">SIGNAL LOST</div>
    <div id="overSub" class="oversub"></div>
    <div id="stats" class="stats"></div>
    <button id="retryBtn" class="btn primary">FLY AGAIN</button>
    <button id="endlessBtn" class="btn hidden">CONTINUE · ENDLESS</button>
    <button id="menuBtn" class="btn ghost">MENU</button>
  </div>
</div>
`;
