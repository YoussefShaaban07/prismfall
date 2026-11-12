import * as THREE from 'three';
import { Renderer } from '../core/Renderer';
import { Input } from '../core/Input';
import { Audio } from '../core/Audio';
import type { Assets } from '../core/Assets';
import { clamp, damp, rand, store, TAU, pickWeighted, chance } from '../core/util';
import { UI, type Settings } from '../ui/UI';
import { Arena } from './Arena';
import { Particles, Debris, Smoke } from './Particles';
import { Effects } from './Effects';
import { Player, SHIP_YAW } from './Player';
import { EnemyManager, type Enemy } from './Enemies';
import { BossController } from './Boss';
import { Projectiles } from './Projectiles';
import { WeaponSystem } from './Weapons';
import { Pickups, type PowerKind } from './Pickups';
import { Hazards } from './Hazards';
import { Lighting } from './Lighting';
import { rollChoices, describe, applyChoice, type Choice } from './Upgrades';
import { ARENA_RADIUS, BOSS_TIMES, FINAL_TIME, xpForLevel, type EType } from './data';
import { ACHIEVEMENTS, MODS, SHIPS, UPGRADES, dailySetup, loadMeta, modMult, saveMeta, shardsForRun, upLv, type MetaState, type ModId, type ShipId } from './meta';
import { heroMapper, alienMapper, type ModelName } from '../core/Assets';
import { LOOKS } from './Boss';
import { renderIcons } from '../ui/Icons';
import { t, tf } from '../ui/i18n';
import { WEAPONS as WDEF, PASSIVES as PDEF } from './data';
import { EDEFS as ED } from './data';

type State = 'menu' | 'play' | 'levelup' | 'paused' | 'over' | 'photo';

const C = (r: number, g: number, b: number, k = 1) => new THREE.Color(r, g, b).multiplyScalar(k);

export class Game {
  r: Renderer;
  input: Input;
  audio = new Audio();
  ui: UI;
  arena: Arena;
  particles: Particles;
  debris: Debris;
  smoke: Smoke;
  fx: Effects;
  player: Player;
  enemies: EnemyManager;
  boss: BossController;
  proj: Projectiles;
  weapons: WeaponSystem;
  pickups: Pickups;
  hazards: Hazards;
  lighting: Lighting;

  colors = {
    cyan: C(0.35, 0.95, 1, 3),
    pink: C(1, 0.3, 0.85, 3),
    violet: C(0.7, 0.5, 1, 3),
    green: C(0.45, 1, 0.6, 3),
    yellow: C(1, 0.9, 0.3, 3),
    orange: C(1, 0.55, 0.15, 3),
    flame: C(1, 0.6, 0.2, 3),
    smoke: C(0.25, 0.2, 0.2, 0.6),
    white: C(1, 1, 1, 3),
    red: C(1, 0.2, 0.25, 3),
    wraith: C(0.4, 0.5, 1, 3),
    debris: new THREE.Color(0.35, 0.33, 0.4),
  };

  state: State = 'menu';
  T = 0; // run time (sim)
  time = 0; // wall time
  kills = 0;
  score = 0;
  combo = 0;
  comboT = 0;
  maxCombo = 0;
  damageDealt = 0;
  pendingLevels = 0;
  bossesKilled = 0;
  nextBoss = BOSS_TIMES[0];
  bossWarn = 0;
  pendingFinal = false;
  won = false;
  endless = false;
  rerolls = 3;
  spawnAcc = 0;
  nextSurge = 50;
  nextElite = 95;
  freezeT = 0;
  slowT = 0;
  deathT = 0;
  victoryT = 0;
  shake = 0;
  hurtT = 0;
  hudT = 0;
  heartT = 0;
  mmT = 0;
  choices: Choice[] = [];
  dmgLog: Record<string, number> = {};
  meta: MetaState;
  showroom = new THREE.Group();
  showShip: THREE.Group | null = null;
  hangarOpen = false;
  previewShip: ShipId = 'comet';
  untouchedT = 0;
  achT = 0;
  runAch: string[] = [];
  paidShards = 0;
  tutStep = 0;
  killsAtEndless = 0;
  bossesAtEndless = 0;
  settings: Settings;

  private camPos = new THREE.Vector3(0, 40, 30);
  private camLook = new THREE.Vector3();
  private last = performance.now();
  snapCam = false;
  private rimLights: THREE.PointLight[] = [];
  private showRingMat!: THREE.MeshBasicMaterial;
  private underGlow!: THREE.Mesh;
  /** accent of whatever is on the showroom pad; lights and rings ease toward it */
  private showAccent = new THREE.Color(0x5ef2ff);
  private showAccentNow = new THREE.Color(0x5ef2ff);
  private tmpC = new THREE.Color();
  private lookSmooth = new THREE.Vector3(0, 4, 0);
  private menuPath = new THREE.CatmullRomCurve3(
    [
      [44, 14, 0], [30, 9, 30], [0, 7, 46], [-34, 12, 32], [-48, 8, 0], [-38, 16, -32], [-6, 22, -46], [28, 11, -34], [44, 10, -10],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true, 'centripetal',
  );
  private menuLook = new THREE.CatmullRomCurve3(
    [
      [0, 3, 0], [0, 3, 0], [-20, 6, 10], [-70, 4, 30], [0, 3, 0], [-120, 30, -140], [0, 3, 0], [80, 10, -60], [0, 3, 0],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true, 'centripetal',
  );
  cineT = 0;
  photo = { yaw: 0.6, pitch: 0.5, dist: 22, drag: null as null | { x: number; y: number }, look: 0, dof: true, aperture: 0.0016, clean: false };
  private timed: { t: number; fn: () => void }[] = [];
  after(t: number, fn: () => void) { this.timed.push({ t, fn }); }
  storm = { k: 0, t: 0, dur: 0, next: 200, flashT: 0 };
  night = false;
  mods = new Set<ModId>();
  dailyKey: string | null = null;
  scoreMult = 1;
  private sunOff = new THREE.Vector3(-30, 45, 18);
  snap: HTMLCanvasElement | null = null;
  private briefed = false;
  private lastEntry: MetaState['top'][number] | null = null;
  private autoQDone = false;

  constructor(canvas: HTMLCanvasElement, public assets: Assets, renderer: Renderer) {
    this.r = renderer;
    this.settings = store.get<Settings>('prismfall.settings', { quality: this.defaultQuality(), sfx: 0.8, music: 0.6, shake: true, numbers: true });
    this.ui = new UI(this.settings);
    this.ui.icons = renderIcons([
      ...Object.values(WDEF).map((w) => ({ id: w.id, color: w.color })),
      ...Object.values(PDEF).map((p) => ({ id: p.id, color: p.color })),
      { id: 'heal' as const, color: '#ff5e7e' }, { id: 'bounty' as const, color: '#ffd84f' },
    ]);
    this.input = new Input(canvas, this.ui.joy, this.ui.knob, this.ui.dashBtn);
    const scene = this.r.scene;
    if (assets.env) {
      scene.environment = assets.env;
      scene.environmentIntensity = 0.4;
    }
    this.arena = new Arena(scene, assets);
    this.particles = new Particles(scene);
    this.debris = new Debris(scene);
    this.smoke = new Smoke(scene);
    this.fx = new Effects(scene, this.r.camera, this.ui.floaters);
    this.player = new Player(scene, assets);
    this.enemies = new EnemyManager(scene, assets, this);
    this.boss = new BossController(scene, assets, this);
    this.proj = new Projectiles(scene, this);
    this.weapons = new WeaponSystem(scene, this);
    this.pickups = new Pickups(scene, assets, this);
    this.hazards = new Hazards(scene, this);
    this.lighting = new Lighting(scene, this);
    this.player.root.visible = false;
    for (const t of this.player.trails) t.visible = false;
    this.player.magnetRing.visible = false;
    this.meta = loadMeta();
    this.previewShip = this.meta.ship;
    this.buildShowroom();
    this.setTheme(this.meta.map === 'night' && this.nightUnlocked());

    this.applySettings(this.settings);
    addEventListener('resize', () => (this.frozenDirty = true));
    this.bindUI();
    canvas.addEventListener('pointerdown', (e) => { if (this.state === 'photo') this.photo.drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointerup', () => (this.photo.drag = null));
    addEventListener('pointermove', (e) => {
      const d = this.photo.drag;
      if (this.state !== 'photo' || !d) return;
      this.photo.yaw -= (e.clientX - d.x) * 0.006;
      this.photo.pitch = Math.min(1.45, Math.max(0.05, this.photo.pitch + (e.clientY - d.y) * 0.004));
      d.x = e.clientX; d.y = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.state !== 'photo') return;
      this.photo.dist = Math.min(60, Math.max(5, this.photo.dist * (1 + Math.sign(e.deltaY) * 0.1)));
      e.preventDefault();
    }, { passive: false });
    this.ui.showMenu(this.meta.stats.bestScore, this.meta.stats.bestTime, this.input.touchUsed, this.meta.shards);
    this.ui.setMapLabel(this.meta.map, this.nightUnlocked());
    this.ui.renderMods(this.meta);
    this.ui.setCodexMeta(this.meta);
    requestAnimationFrame(this.loop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause();
    });
  }

  private defaultQuality() {
    const touch = 'ontouchstart' in window;
    return touch ? 'low' : 'high';
  }

  private bindUI() {
    const ui = this.ui;
    ui.onPlay = () => {
      if (!this.meta.seenTutorial && this.meta.stats.runs === 0 && !this.briefed) {
        this.briefed = true;
        this.audio.init();
        ui.hideAll();
        ui.briefing().then(() => this.startRun());
      } else this.startRun();
    };
    ui.onRetry = () => this.startRun(!!this.dailyKey);
    ui.onResume = () => this.togglePause();
    ui.onQuit = () => this.toMenu();
    ui.onEndless = () => this.continueEndless();
    ui.onClick = () => this.audio.sfx('click');
    ui.onSettings = (s) => {
      if (s.quality !== this.r.quality) store.set('prismfall.qualityLocked', true);
      this.applySettings(s);
    };
    ui.onHangar = (open) => {
      this.hangarOpen = open;
      this.previewShip = this.meta.ship;
      this.setShowShip(this.previewShip);
      if (open) ui.openHangar(this.meta, this.previewShip);
      else ui.closeHangar();
    };
    ui.onDaily = () => this.startRun(true);
    ui.onPhoto = () => this.togglePhoto();
    ui.onPhotoKey = (c) => this.photoKey(c);
    ui.onShareCard = () => ({
      snap: this.snap, victory: this.won, score: Math.round(this.score), time: this.T, level: this.player.level, kills: this.kills,
      bosses: this.bossesKilled, ship: this.player.shipDef.name, sector: this.night ? 'NIGHT SHIFT' : 'DUSK OUTPOST',
      mods: [...this.mods].map((m) => MODS.find((x) => x.id === m)!.name),
      portrait: this.shipPortrait(),
      accent: '#' + new THREE.Color(this.player.shipDef.accent).getHexString(),
    });
    ui.onCodex = (open, kind, id) => {
      this.hangarOpen = open;
      if (open) this.showCodexModel(kind, id);
      else this.setShowShip(this.meta.ship);
    };
    ui.onModToggle = (id) => {
      const i = this.meta.mods.indexOf(id);
      if (i >= 0) this.meta.mods.splice(i, 1);
      else this.meta.mods.push(id);
      saveMeta(this.meta);
      this.audio.sfx('click');
      ui.renderMods(this.meta);
    };
    ui.onMapToggle = () => {
      if (!this.nightUnlocked()) {
        this.ui.toast('NIGHT SHIFT LOCKED', 'Destroy the Prism Core once to unlock');
        return;
      }
      this.meta.map = this.meta.map === 'night' ? 'dusk' : 'night';
      saveMeta(this.meta);
      this.setTheme(this.meta.map === 'night');
      this.ui.setMapLabel(this.meta.map, true);
      this.audio.sfx('select');
    };
    ui.onShipPreview = (id) => {
      this.previewShip = id;
      this.setShowShip(id);
      ui.renderHangar(this.meta, id);
    };
    ui.onShipAction = (id) => {
      const def = SHIPS.find((x) => x.id === id)!;
      if (!this.meta.owned.includes(id)) {
        if (this.meta.shards < def.cost) return;
        this.meta.shards -= def.cost;
        this.meta.owned.push(id);
        this.audio.sfx('evolve');
        if (this.meta.owned.length === SHIPS.length) this.unlockAch('all_ships');
      } else this.audio.sfx('select');
      this.meta.ship = id;
      saveMeta(this.meta);
      ui.renderHangar(this.meta, id);
    };
    ui.onBuy = (id) => {
      const u = UPGRADES.find((x) => x.id === id)!;
      const lv = upLv(this.meta, id);
      if (lv >= u.max || this.meta.shards < u.cost(lv)) return;
      this.meta.shards -= u.cost(lv);
      this.meta.upgrades[id] = lv + 1;
      saveMeta(this.meta);
      this.audio.sfx('level');
      ui.renderHangar(this.meta, this.previewShip);
    };
    this.input.onPause = () => {
      if (this.state === 'photo') { this.togglePhoto(); return; }
      if (this.state !== 'play' && ui.back()) return;
      this.togglePause();
    };
    this.input.onKey = (code) => {
      if (this.state === 'levelup') {
        if (code === 'Digit1' || code === 'Numpad1') ui.pick(0);
        if (code === 'Digit2' || code === 'Numpad2') ui.pick(1);
        if (code === 'Digit3' || code === 'Numpad3') ui.pick(2);
        if (code === 'KeyR') ui.reroll();
      }
      if (this.state !== 'play') {
        if (code === 'ArrowUp') ui.navigate(0, -1);
        if (code === 'ArrowDown') ui.navigate(0, 1);
        if (code === 'ArrowLeft') ui.navigate(-1, 0);
        if (code === 'ArrowRight') ui.navigate(1, 0);
      }
      if (this.state === 'menu' && code === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) this.startRun();
      if (this.state === 'over' && code === 'Enter') this.startRun();
      if (code === 'KeyM') this.audio.toggleMute();
      if (code === 'F2') this.togglePhoto();
      else if (this.state === 'photo') this.photoKey(code);
      if (code === 'F3') this.togglePerf();
    };
    this.input.onPadButton = (i) => {
      // D-pad / A / B drive menus whenever a screen is open
      if (this.state !== 'play') {
        if (i === 12) ui.navigate(0, -1);
        if (i === 13) ui.navigate(0, 1);
        if (i === 14) ui.navigate(-1, 0);
        if (i === 15) ui.navigate(1, 0);
        if (i === 0 && ui.activate()) return;
        if (i === 1 && ui.back()) return;
      }
      if (this.state === 'levelup') {
        if (i === 2) ui.pick(0);
        if (i === 3) ui.pick(1);
        if (i === 1) ui.pick(2);
        if (i === 4) ui.reroll();
      } else if ((this.state === 'menu' || this.state === 'over') && i === 0 && !(document.activeElement instanceof HTMLButtonElement)) this.startRun();
    };
  }

  private buildShowroom() {
    const pad = this.assets.object('platform_large', 7, heroMapper(0x5ef2ff, 0.3));
    this.showroom.add(pad);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 1).multiplyScalar(0.8), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.showRingMat = ringMat;
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(3.3 + i * 0.5, 0.04, 8, 96), ringMat);
      r.rotation.x = Math.PI / 2;
      r.position.y = 0.35 + i * 0.05;
      this.showroom.add(r);
    }
    const spot = new THREE.SpotLight(0xbff8ff, 9, 30, 0.5, 0.6, 1.5);
    spot.position.set(4, 12, 6);
    spot.target.position.set(0, 1, 0);
    this.showroom.add(spot, spot.target);
    // polished black-chrome pad top: reflects the HDR sky and the orbiting rim lights
    const padTop = (pad.userData.height as number) + 0.02;
    const chrome = new THREE.Mesh(
      new THREE.CircleGeometry(3.25, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x0b0d14, metalness: 1, roughness: 0.12, envMapIntensity: 1.4 }),
    );
    chrome.position.y = padTop;
    chrome.receiveShadow = true;
    this.showroom.add(chrome);
    // hover under-glow pooled on the chrome, tinted by whatever sits on the pad
    this.underGlow = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 48).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(0x5ef2ff) }, uK: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec2 vUv;
          void main(){ float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 14.0) * 0.7 + exp(-pow((r - 0.95) * 18.0, 2.0)) * 0.25;
            gl_FragColor = vec4(uColor * a * uK, 1.0); }`,
      }),
    );
    this.underGlow.position.y = padTop + 0.015;
    this.showroom.add(this.underGlow);
    // turntable rim lights orbit the ship
    for (const c of [0x5ef2ff, 0xff4fd8]) {
      const l = new THREE.PointLight(c, 0, 12, 1.5);
      this.showroom.add(l);
      this.rimLights.push(l);
    }
    this.r.scene.add(this.showroom);
    this.setShowShip(this.meta.ship);
  }

  private setShowShip(id: ShipId) {
    const def = SHIPS.find((x) => x.id === id)!;
    this.setShowModel(def.model, 4.2, heroMapper(def.accent, 0.5));
    // engines idling on the pad: same nozzle layout as the flying ship, scaled to the showroom model
    const holder = new THREE.Group();
    const model = this.showShip!;
    this.showroom.remove(model);
    model.position.set(0, 0, 0);
    model.rotation.y = SHIP_YAW;
    holder.add(model);
    const k = 4.2 / 2.4;
    const fMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.accent).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.showFlames.length = 0;
    for (const sx of [-0.42, 0.42]) {
      const f = new THREE.Mesh(this.flameGeo, fMat);
      f.position.set(sx * k, 0.38 * k, -1.0 * k);
      f.scale.setScalar(k);
      const core = new THREE.Mesh(this.flameGeo, coreMat);
      core.scale.set(0.45, 0.45, 0.6);
      f.add(core);
      holder.add(f);
      this.showFlames.push(f);
    }
    this.showY = 1.45;
    holder.position.y = this.showY;
    holder.rotation.order = 'YXZ'; // yaw outermost so the pose's pitch and bank stay in the ship's frame
    this.showShip = holder;
    this.showroom.add(holder);
    this.showAccent.set(def.accent);
    this.showPose = true;
  }
  /** ships strike a flying pose (nose up, gentle bank); codex creatures just turn */
  private showPose = true;
  private showY = 1.45;
  private showFlames: THREE.Mesh[] = [];
  private flameGeo = (() => {
    const g = new THREE.ConeGeometry(0.16, 1, 12, 1, true);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -0.5);
    return g;
  })();
  /** Idle thrust flicker for the hangar ship: a slow breath plus fast turbulence. */
  private flickerShowFlames() {
    if (!this.showShip) return;
    const k = 4.2 / 2.4;
    for (let i = 0; i < this.showFlames.length; i++) {
      const f = this.showFlames[i];
      if (f.parent !== this.showShip) continue;
      const breath = 0.75 + Math.sin(this.time * 2.1 + i * 1.7) * 0.12;
      const z = breath * (0.85 + Math.random() * 0.3);
      f.scale.set(k * (0.92 + Math.random() * 0.12), k * (0.92 + Math.random() * 0.12), k * z);
    }
  }

  private setShowModel(model: ModelName, size: number, mapper: ReturnType<typeof heroMapper>) {
    if (this.showShip) this.showroom.remove(this.showShip);
    this.showShip = this.assets.object(model, size, mapper);
    // hover low over the pad so it reads as sitting on it (big models get a little more clearance)
    this.showY = Math.max(1.45, size * 0.42 + 0.5);
    this.showShip.position.y = this.showY;
    this.showroom.add(this.showShip);
    this.showPose = false;
  }

  /** Codex preview: show an enemy or boss model on the showroom pad. */
  showCodexModel(kind: 'enemy' | 'boss' | 'ship', id: string) {
    if (kind === 'enemy') {
      const d = ED[id as EType];
      this.setShowModel(d.model, Math.min(5, d.size * 2.4), alienMapper(d.color, 1.2, 1));
      this.showAccent.set(d.color);
    } else if (kind === 'boss') {
      const i = Number(id);
      if (i === 3) this.setShowModel('rock_crystalsLargeA', 5, alienMapper(0x7ff6ff, 1.6, 0.7));
      else this.setShowModel(LOOKS[i].model, 5.2, alienMapper(LOOKS[i].color, 0.6, 0.7));
      this.showAccent.set(i === 3 ? 0x7ff6ff : LOOKS[i].color);
    } else this.setShowShip(this.meta.ship);
  }

  /** Switch between the dusk outpost and the Night Shift sector. */
  setTheme(night: boolean) {
    this.night = night;
    const r = this.r;
    this.arena.groundUniforms.uNight.value = night ? 1 : 0;
    this.arena.skyMat.uniforms.uNight.value = night ? 1 : 0;
    const env = night ? this.assets.envNight : this.assets.env;
    if (env) r.scene.environment = env;
    r.scene.environmentIntensity = night ? 0.25 : 0.4;
    r.sun.color.set(night ? 0x9fb8ff : 0xffc29a);
    r.sun.intensity = night ? 1.4 : 2.0;
    this.sunOff.set(night ? 25 : -30, night ? 50 : 45, night ? -20 : 18);
    r.hemi.color.set(night ? 0x3a4a90 : 0x9fb8ff);
    r.hemi.groundColor.set(night ? 0x100a18 : 0x4a2116);
    r.hemi.intensity = night ? 0.7 : 0.55;
    (r.scene.fog as THREE.Fog).color.set(night ? 0x141a30 : 0x7a4a40);
    (r.scene.background as THREE.Color).set(night ? 0x05060c : 0x1a0d12);
    (this.arena.dust.material as THREE.PointsMaterial).color.set(night ? 0x8ab0ff : 0xffb08a);
    this.player.light.intensity = night ? 9 : 4;
    this.audio.theme = night ? 'night' : 'dusk';
    this.arena.setNight(night);
    r.bloom.strength = (this.settings.quality === 'low' ? 0.5 : 0.6) * (night ? 0.75 : 1);
    this.applyThemeGrade();
  }

  /** The theme's own split-tone (cool shadows / warm highlights at dusk, bluer at night). */
  private applyThemeGrade() {
    const g = this.r.grade.uniforms, night = this.night;
    (g.uShadowTint.value as THREE.Vector3).set(night ? -0.03 : -0.02, night ? 0.01 : 0.03, night ? 0.08 : 0.06);
    (g.uHighTint.value as THREE.Vector3).set(night ? 0.0 : 0.05, night ? 0.03 : 0.02, night ? 0.05 : -0.03);
  }

  nightUnlocked() {
    return this.meta.stats.wins > 0 || this.meta.achievements.includes('win');
  }

  applySettings(s: Settings) {
    this.frozenDirty = true;
    this.settings = s;
    store.set('prismfall.settings', s);
    if (this.lighting) this.lighting.setLightsEnabled(s.quality !== 'low');
    // phones on LOW: fewer live particles and smoke puffs (additive overdraw is their bottleneck)
    if (this.particles) this.particles.limit = s.quality === 'low' ? 2600 : this.particles.max;
    if (this.smoke) this.smoke.limit = s.quality === 'low' ? 600 : this.smoke.max;
    if (this.r.quality !== s.quality) this.r.setQuality(s.quality);
    this.audio.setVolumes(s.sfx, s.music);
    this.r.bloom.strength = (s.quality === 'low' ? 0.5 : 0.6) * (this.night ? 0.75 : 1);
  }

  /* ======================= flow ======================= */

  startRun(daily = false) {
    if (typeof daily !== 'boolean') daily = false;
    this.audio.init();
    this.audio.startMusic();
    this.audio.resetMusic();
    this.enemies.clear();
    this.boss.clear();
    this.proj.clear();
    this.hazards.clear();
    this.pickups.clear();
    this.particles.clear();
    this.smoke.clear();
    this.debris.clear();
    this.fx.clear();
    this.weapons.reset();
    const ds = daily ? dailySetup() : null;
    this.dailyKey = ds ? ds.key : null;
    this.mods = new Set(ds ? ds.mods : this.meta.mods);
    const ship = SHIPS.find((x) => x.id === (ds ? ds.ship : this.meta.ship)) ?? SHIPS[0];
    this.player.reset(this.meta, ship);
    if (this.mods.has('glass')) {
      this.player.dmg *= 1.5;
      this.player.maxHp = this.player.hp = Math.ceil(this.player.maxHp / 2);
    }
    this.scoreMult = modMult([...this.mods]) * (this.night ? 1.5 : 1);
    this.player.root.visible = true;
    this.showroom.visible = false;
    this.hangarOpen = false;
    for (const l of this.rimLights) l.intensity = 0;
    this.r.camera.clearViewOffset();
    this.player.magnetRing.visible = true;
    Object.assign(this, {
      dmgLog: {}, T: 0, kills: 0, score: 0, combo: 0, comboT: 0, maxCombo: 0, damageDealt: 0, pendingLevels: 0,
      bossesKilled: 0, nextBoss: BOSS_TIMES[0], bossWarn: 0, won: false, endless: false, rerolls: 3 + upLv(this.meta, 'rerolls'), untouchedT: 0, achT: 0, runAch: [], paidShards: 0, tutStep: this.meta.seenTutorial ? 99 : 0,
      cineT: 0, timed: [], lastEntry: null, storm: { k: 0, t: 0, dur: 0, next: 170 + Math.random() * 60, flashT: 0 }, spawnAcc: 0, nextSurge: 50, nextElite: 95, freezeT: 0, slowT: 0, deathT: 0, victoryT: 0, shake: 0, hurtT: 0,
    });
    this.input.releaseAll();
    this.input.enabled = true;
    this.state = 'play';
    document.body.classList.remove('cine');
    this.applyStorm(0);
    this.ui.startRun(this.input.touchUsed);
    const modNames = [...this.mods].map((m) => MODS.find((x) => x.id === m)!.name).join(' · ');
    if (ds) this.ui.banner('DAILY CHALLENGE', `${ship.name} · ${modNames}`, '#ffd84f', 3000);
    else this.ui.banner('DEFEND THE COLONY', modNames || 'Survive · Level up · Evolve', '#5ef2ff', 2400);
    // opening ring of drones dropping in
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      this.enemies.spawn('drone', Math.cos(a) * 14, Math.sin(a) * 14);
    }
  }

  toMenu() {
    this.state = 'menu';
    this.input.enabled = false;
    this.input.releaseAll();
    this.enemies.clear();
    this.boss.clear();
    this.proj.clear();
    this.hazards.clear();
    this.pickups.clear();
    this.fx.clear();
    this.player.root.visible = false;
    for (const t of this.player.trails) t.visible = false;
    this.player.magnetRing.visible = false;
    this.weapons.reset();
    this.ui.hideHud();
    this.audio.intensity = 0;
    document.body.classList.remove('lowhp', 'cine');
    this.cineT = 0;
    this.storm.k = 0;
    this.applyStorm(0);
    this.ui.showMenu(this.meta.stats.bestScore, this.meta.stats.bestTime, this.input.touchUsed, this.meta.shards);
    this.ui.setMapLabel(this.meta.map, this.nightUnlocked());
    this.ui.renderMods(this.meta);
    this.showroom.visible = true;
  }

  /** Photo mode: freeze the action, hide the HUD, orbit a free camera (drag / arrows, wheel to zoom). */
  togglePhoto() {
    if (this.state === 'play' || this.state === 'paused') {
      if (this.state === 'paused') this.ui.hidePause();
      this.state = 'photo';
      this.input.releaseAll();
      document.body.classList.add('photo');
      this.applyLook(this.photo.look);
      this.syncPhotoBar();
      this.ui.hint('PHOTO MODE · drag or arrows to orbit · wheel to zoom · F2 to exit', 3000);
    } else if (this.state === 'photo') {
      document.body.classList.remove('photo', 'photo-clean');
      this.photo.clean = false;
      this.applyLook(0);
      this.r.bokeh.enabled = false;
      this.state = 'play';
      this.last = performance.now();
    }
  }

  /** Colour looks for photo mode, applied through the grade pass. Look 0 is the game's own grade. */
  static LOOKS = [
    { name: 'NATURAL' },
    { name: 'NOIR', sat: 0, contrast: 1.42, grain: 0.065, tint: [1.0, 0.98, 0.93], sh: [0, 0, 0], hi: [0.02, 0.02, 0.02], vig: 1.4 },
    { name: 'WARM FILM', sat: 0.9, contrast: 1.14, grain: 0.05, tint: [1.1, 0.98, 0.82], sh: [0.0, 0.02, 0.05], hi: [0.07, 0.03, -0.04], vig: 1.28 },
    { name: 'NEON', sat: 1.6, contrast: 1.2, grain: 0.018, tint: [1.0, 0.96, 1.05], sh: [0.06, -0.03, 0.12], hi: [-0.03, 0.05, 0.07], vig: 1.15 },
    { name: 'FROST', sat: 0.72, contrast: 1.06, grain: 0.03, tint: [0.86, 1.0, 1.14], sh: [-0.02, 0.03, 0.09], hi: [0.03, 0.05, 0.07], vig: 1.1 },
  ] as { name: string; sat?: number; contrast?: number; grain?: number; tint?: number[]; sh?: number[]; hi?: number[]; vig?: number }[];

  applyLook(i: number) {
    const u = this.r.grade.uniforms;
    const L = Game.LOOKS[i] ?? Game.LOOKS[0];
    if (i === 0 || !L.sat && L.sat !== 0) {
      u.uSat.value = 1.12;
      u.uContrast.value = 1.08;
      u.uGrain.value = 0.025;
      (u.uTint.value as THREE.Vector3).set(1, 1, 1);
      u.uVignette.value = 1;
      this.applyThemeGrade();
      return;
    }
    u.uSat.value = L.sat!;
    u.uContrast.value = L.contrast!;
    u.uGrain.value = L.grain!;
    (u.uTint.value as THREE.Vector3).fromArray(L.tint!);
    (u.uShadowTint.value as THREE.Vector3).fromArray(L.sh!);
    (u.uHighTint.value as THREE.Vector3).fromArray(L.hi!);
    u.uVignette.value = L.vig!;
  }

  photoKey(code: string) {
    const ph = this.photo;
    if (code === 'KeyL' || code === 'BracketRight') ph.look = (ph.look + 1) % Game.LOOKS.length;
    else if (code === 'BracketLeft') ph.look = (ph.look + Game.LOOKS.length - 1) % Game.LOOKS.length;
    else if (code === 'KeyF') ph.dof = !ph.dof;
    else if (code === 'Minus') ph.aperture = Math.max(0.0004, ph.aperture / 1.4);
    else if (code === 'Equal') ph.aperture = Math.min(0.006, ph.aperture * 1.4);
    else if (code === 'KeyH') {
      ph.clean = !ph.clean;
      document.body.classList.toggle('photo-clean', ph.clean);
    } else if (code === 'KeyP' || code === 'Enter') return void this.savePhoto();
    else return;
    this.applyLook(ph.look);
    this.syncPhotoBar();
  }

  private syncPhotoBar() {
    const ph = this.photo;
    this.ui.setPhotoBar(Game.LOOKS[ph.look].name, ph.dof, Math.round(Math.log(ph.aperture / 0.0004) / Math.log(1.4)));
  }

  /** A studio render of the current ship (transparent background) for the share card. */
  private shipPortrait(): HTMLCanvasElement | null {
    let rr: THREE.WebGLRenderer;
    const size = 640;
    try {
      const canvas = document.createElement('canvas');
      rr = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch {
      return null;
    }
    rr.setSize(size, size, false);
    rr.setPixelRatio(1);
    rr.toneMapping = THREE.ACESFilmicToneMapping;
    rr.outputColorSpace = THREE.SRGBColorSpace;
    const def = this.player.shipDef;
    const scene = new THREE.Scene();
    const accent = new THREE.Color(def.accent);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a1830, 0.85));
    const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
    key.position.set(4, 6, 5);
    const rim = new THREE.DirectionalLight(accent, 5);
    rim.position.set(-5, 2, -6);
    const fill = new THREE.PointLight(accent, 30, 12);
    fill.position.set(0, -2.5, 2.5);
    scene.add(key, rim, fill);
    const ship = this.assets.object(def.model, 3.2, heroMapper(def.accent, 1.1));
    const holder = new THREE.Group();
    ship.rotation.y = SHIP_YAW;
    holder.add(ship);
    holder.rotation.set(0.5, 0.75, -0.12); // three-quarter hero angle, nose toward the viewer's left
    scene.add(holder);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 0.4, 8.2);
    cam.lookAt(0, 0, 0);
    rr.render(scene, cam);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')!.drawImage(rr.domElement, 0, 0);
    rr.dispose();
    rr.forceContextLoss();
    return out;
  }

  /** Render one clean frame and download it as a PNG. */
  savePhoto() {
    this.r.render(this.time);
    this.r.renderer.domElement.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `prismfall-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    this.ui.flash('rgba(255,255,255,0.5)');
    this.audio.sfx('click');
  }

  togglePause() {
    if (this.state === 'photo') return this.togglePhoto();
    if (this.state === 'play') this.pause();
    else if (this.state === 'paused') this.resume();
  }
  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.releaseAll();
    this.ui.showPause(this.player.weapons, this.player.passives, this.player.evolved, { time: this.T, level: this.player.level, kills: this.kills, score: this.score });
  }
  resume() {
    if (this.state !== 'paused') return;
    this.ui.hidePause();
    this.state = 'play';
    this.last = performance.now();
  }

  continueEndless() {
    this.endless = true;
    this.killsAtEndless = this.kills;
    this.bossesAtEndless = this.bossesKilled;
    this.state = 'play';
    this.input.enabled = true;
    this.nextBoss = this.T + 90;
    this.ui.startRun(this.input.touchUsed);
    this.ui.banner('ENDLESS MODE', 'How long can you last?', '#ffd84f');
  }

  /* ======================= main loop ======================= */

  debugHold = false;

  /** Debug: advance visuals by dt without the rAF loop (for deterministic screenshots). */
  debugFrame(dt: number, render = true) {
    // deterministic captures always render at full resolution
    if (this.r.renderScale < 1) this.r.setRenderScale(1);
    this.time += dt;
    if (this.state === 'play') this.update(dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.updateCamera(dt);
    this.updateHullLook();
    this.arena.update(dt, this.time, this.player.x, this.player.z, 0);
    this.enemies.sync(this.time);
    this.boss.sync(this.time, dt);
    this.proj.sync(this.time);
    this.pickups.sync(this.time);
    this.updateDistort(dt);
    const ps = this.r.pointScale();
    this.particles.mat.uniforms.uScale.value = ps;
    this.smoke.mat.uniforms.uScale.value = ps;
    if (render) this.r.render(this.time);
  }

  private hazeV = new THREE.Vector3();
  private hazeV2 = new THREE.Vector3();
  /** Shockwaves plus engine heat haze in the hangar; the full-screen pass only runs when either is live. */
  private updateDistort(dt: number) {
    const R = this.r;
    const u = R.distort.uniforms;
    const live = this.fx.writeShocks(dt, u.uWaves.value as THREE.Vector4[], R.width / R.height);
    const haze = u.uHaze.value as THREE.Vector4;
    haze.w = 0;
    if (this.state === 'menu' && this.hangarOpen && this.showShip && this.showFlames.length && this.showroom.visible) {
      const c = this.hazeV.set(0, 0, 0);
      for (const f of this.showFlames) c.add(f.getWorldPosition(this.hazeV2));
      c.multiplyScalar(1 / this.showFlames.length);
      const top = this.hazeV2.copy(c);
      top.y += 1.6;
      top.project(R.camera);
      c.project(R.camera);
      if (c.z < 1) haze.set(c.x * 0.5 + 0.5, c.y * 0.5 + 0.5, Math.max(0.03, Math.abs(top.y - c.y) * 0.5), this.settings.calm ? 0.4 : 1);
    }
    u.uTime.value = this.time % 1000;
    R.distort.enabled = live > 0 || haze.w > 0;
  }

  /** The ship shows its wounds: cracks open below half hull and widen toward zero; hits flash it. */
  private updateHullLook() {
    const P = this.player;
    const frac = P.maxHp > 0 ? P.hp / P.maxHp : 1;
    const dmg = this.state === 'menu' ? 0 : frac < 0.5 ? Math.min(1, 0.18 + (0.5 - Math.max(0, frac)) * 1.6) : 0;
    P.setHullLook(dmg, this.hurtT > 0 ? (this.hurtT / 0.25) * 0.5 : 0);
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    if (this.debugHold) { this.last = now; return; }
    const rawMs = now - this.last;
    this.realDt = clamp(rawMs / 1000, 0, 0.05);
    let dt = clamp(rawMs / 1000, 0, 0.05);
    this.last = now;
    this.time += dt;
    this.input.update();
    this.autoQuality(dt, rawMs);
    this.updatePerf(rawMs);

    if (this.state === 'play') {
      if (this.freezeT > 0) {
        this.freezeT -= dt;
        dt = 0;
      }
      if (this.slowT > 0) {
        this.slowT -= dt;
        dt *= 0.3;
      }
      if (this.mods.has('speed')) dt *= 1.15;
      if (this.cineT > 0) {
        this.cineT -= dt;
        document.body.classList.toggle('cine', this.cineT > 0);
        dt *= 0.62;
      }
      this.update(dt);
    } else if (this.state === 'menu') {
      this.updateMenu(dt);
    } else if (this.state === 'over') {
      // let effects settle behind the results screen
      this.particles.update(dt * 0.5);
      this.smoke.update(dt * 0.5);
      this.debris.update(dt * 0.5);
      this.fx.update(dt * 0.5, this.r.width, this.r.height);
    }

    this.updateCamera(dt);
    this.updateHullLook();
    this.arena.placeSun(this.r.camera, this.night);
    this.updateShafts(dt);
    this.arena.update(dt, this.time, this.player.x, this.player.z, this.boss.e ? 1 : this.bossWarn > 0 ? 0.6 : 0);
    if (this.state !== 'menu') {
      this.enemies.sync(this.time);
      this.boss.sync(this.time, dt);
      this.proj.sync(this.time);
      this.pickups.sync(this.time);
    }
    this.lighting.update(this.state === 'play' ? dt : 0.016);
    this.updateDistort(this.state === 'play' ? dt : 0.016);
    const ps = this.r.pointScale();
    this.particles.mat.uniforms.uScale.value = ps;
    this.smoke.mat.uniforms.uScale.value = ps;
    const g = this.r.grade.uniforms;
    const calm = !!this.settings.calm;
    g.uHurt.value = damp(g.uHurt.value as number, this.hurtT > 0 ? (calm ? 0.2 : 0.55) : 0, 10, dt || 0.016);
    g.uAberr.value = damp(g.uAberr.value as number, calm ? 0 : this.hurtT > 0 ? 1 : this.player.dashing ? 0.6 : 0, 12, dt || 0.016);
    this.hurtT = Math.max(0, this.hurtT - dt);
    // Level-up and pause freeze the world behind a blurred overlay. Re-rendering an identical
    // frame every tick also forces the browser to re-blur it, which is what drags integrated GPUs
    // down to single digits; draw a few settle frames and then hold the image.
    const frozen = this.state === 'levelup' || this.state === 'paused';
    this.frozenT = frozen ? this.frozenT + rawMs / 1000 : 0;
    if (!frozen || this.frozenT < 0.3 || this.frozenDirty) {
      this.frozenDirty = false;
      this.r.render(this.time);
    }
  };
  private frozenT = 0;
  /** Set to force one redraw while frozen (resize, settings change). */
  frozenDirty = false;

  /**
   * Frame-budget controller. Every second it compares GPU time (timer queries when the browser
   * exposes them, raw frame time otherwise) against a 60 fps budget and scales the render
   * resolution between 50% and 100%. If the floor is reached and the device still can't keep up,
   * it steps the quality tier down; a fast machine on HIGH gets bumped to ULTRA once.
   */
  /* F3 performance overlay: fps, GPU ms, render scale, draw calls */
  private perfEl: HTMLDivElement | null = null;
  private perfAcc = 0;
  private perfN = 0;
  togglePerf() {
    if (this.perfEl) {
      this.perfEl.remove();
      this.perfEl = null;
      return;
    }
    const el = document.createElement('div');
    el.className = 'perf-hud';
    document.body.appendChild(el);
    this.perfEl = el;
  }
  private updatePerf(rawMs: number) {
    if (!this.perfEl) return;
    this.perfAcc += rawMs;
    this.perfN++;
    if (this.perfAcc < 500) return;
    const fps = (1000 * this.perfN) / this.perfAcc;
    this.perfAcc = this.perfN = 0;
    const R = this.r;
    const i = R.renderer.info.render;
    const px = R.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.perfEl.textContent = `${fps.toFixed(0)} FPS · GPU ${R.gpuMs > 0 ? R.gpuMs.toFixed(1) + ' ms' : 'n/a'} · ${this.settings.quality.toUpperCase()} ${Math.round(R.renderScale * 100)}% (${px.x}×${px.y}) · ${i.calls} draws`;
  }

  private qWinT = 0;
  private qWinN = 0;
  private qWinRaw = 0;
  private qUpVotes = 0;
  private qFloorT = 0;
  /** Pin full resolution (screenshots, benchmarks): ?fixedres or set from the console. */
  fixedRes = new URLSearchParams(location.search).has('fixedres');
  private autoQuality(_dt: number, rawMs: number) {
    if (this.fixedRes) {
      if (this.r.renderScale < 1) this.r.setRenderScale(1);
      return;
    }
    if (this.state !== 'play' && this.state !== 'menu') return;
    if (rawMs <= 0 || rawMs > 1000) return; // tab was hidden
    this.qWinRaw += rawMs;
    this.qWinN++;
    this.qWinT += rawMs / 1000;
    if (this.qWinT < 1) return;
    const frame = this.qWinRaw / this.qWinN;
    this.qWinT = this.qWinRaw = this.qWinN = 0;
    const gpu = this.r.gpuMs;
    const cost = gpu > 0 ? gpu : frame;
    const budget = 14.5;
    const R = this.r;
    let scale = R.renderScale;
    if (cost > budget * 1.12 && frame > 17.5) {
      // fragment cost scales with pixel count, i.e. with scale squared
      scale *= clamp(Math.sqrt(budget / cost), 0.7, 0.95);
      this.qUpVotes = 0;
    } else if (cost < budget * 0.62 && scale < 1) {
      if (++this.qUpVotes >= 2) {
        scale = Math.min(1, scale * 1.08);
        this.qUpVotes = 0;
      }
    } else this.qUpVotes = 0;
    R.setRenderScale(scale);

    if (this.state !== 'play' || this.T < 4) return;
    const locked = store.get('prismfall.qualityLocked', false);
    const q = this.settings.quality;
    // stuck at the resolution floor and still slow: drop a tier
    if (R.renderScale <= 0.51 && frame > 22) this.qFloorT += 1;
    else this.qFloorT = 0;
    if (!locked && q !== 'low' && this.qFloorT >= 3) {
      this.qFloorT = 0;
      this.settings.quality = q === 'ultra' ? 'high' : 'low';
      this.applySettings(this.settings);
      R.setRenderScale(0.8);
      this.ui.toast('GRAPHICS ADJUSTED', tf('Switched to {0} for smoother play (Pause → Graphics)', t(this.settings.quality.toUpperCase())));
    } else if (!locked && !this.autoQDone && q === 'high' && R.renderScale >= 1 && gpu > 0 && gpu < 6 && frame < 18 && !('ontouchstart' in window)) {
      this.autoQDone = true;
      this.settings.quality = 'ultra';
      this.applySettings(this.settings);
    }
  }

  private shaftK = 0;
  /** God rays only where they read well: menus and low camera angles, when the sun is on screen. */
  private updateShafts(dt: number) {
    const u = this.r.shafts.uniforms;
    const sp = this.arena.sunHolder.getWorldPosition(new THREE.Vector3()).project(this.r.camera);
    const onScreen = sp.z < 1 && Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3;
    const want = this.state === 'menu' && onScreen && this.r.quality !== 'low' ? (this.night ? 0.6 : 1) : 0;
    this.shaftK += (want - this.shaftK) * Math.min(1, dt * 3);
    (u.uSun.value as THREE.Vector2).set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    u.uStrength.value = this.shaftK < 0.01 ? 0 : this.shaftK * (1 - Math.min(1, Math.hypot(sp.x, sp.y) * 0.45));
    (u.uTint.value as THREE.Color).set(this.night ? 0x9fc0ff : 0xffb070);
    this.r.shafts.enabled = this.shaftK >= 0.01;
  }

  private updateMenu(dt: number) {
    this.updateDevils(dt);
    this.smoke.update(dt);
    const showcase = this.hangarOpen;
    // the showroom takes on the colour of what's on the pad: one rim light in its accent, the other
    // in a complementary hue, rings and under-glow following along
    const acc = this.showAccentNow.lerp(this.showAccent, Math.min(1, dt * 4));
    const comp = this.tmpC.copy(acc).offsetHSL(0.42, 0, 0);
    this.rimLights.forEach((l, i) => {
      const a = this.time * 0.8 + i * Math.PI;
      l.position.set(Math.cos(a) * 5, 3.5 + Math.sin(this.time * 0.6 + i) * 0.8, Math.sin(a) * 5);
      l.intensity = showcase ? 25 : 0;
      l.color.copy(i === 0 ? acc : comp);
    });
    this.showRingMat.color.copy(acc).multiplyScalar(0.8);
    const hover = Math.sin(this.time * 1.5);
    (this.underGlow.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(acc);
    (this.underGlow.material as THREE.ShaderMaterial).uniforms.uK.value = showcase ? 0.32 - hover * 0.1 : 0.12;
    if (this.showShip) {
      this.showShip.rotation.y = this.time * 0.5;
      this.showShip.position.y = this.showY + hover * 0.14;
      if (this.showPose) {
        this.showShip.rotation.x = -0.07 + Math.sin(this.time * 0.9) * 0.03;
        this.showShip.rotation.z = Math.sin(this.time * 0.7) * 0.09;
      }
      this.flickerShowFlames();
    }
    this.arena.groundUniforms.uPulse.value = 0.3;
    this.particles.update(dt);
    // ambient sparks rising from the ground
    if (Math.random() < 0.6) {
      const a = rand(0, TAU), d = rand(5, 40);
      this.particles.emit(Math.cos(a) * d, 0.2, Math.sin(a) * d, 0, rand(1, 3), 0, rand(1.5, 3), rand(0.2, 0.5), chance(0.5) ? this.colors.cyan : this.colors.pink, 0.2, 0);
    }
  }

  private updateCamera(dt: number) {
    const cam = this.r.camera;
    const aspect = this.r.width / this.r.height;
    this.r.bokeh.enabled = this.state === 'menu' && this.hangarOpen && this.r.quality !== 'low';
    // hold the punch during the freeze, then release over ~0.4 s (real time, so hit-stop can't stall it)
    if (this.freezeT <= 0 || this.state !== 'play') this.punch = Math.max(0, this.punch - this.realDt * 2.4);
    const fov = 48 * (1 - (this.settings.calm ? 0 : this.punch * this.punch * 0.09));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (this.state === 'photo') {
      const ph = this.photo, k = this.input.keys;
      if (k.has('ArrowLeft') || k.has('KeyA')) ph.yaw -= dt * 1.2;
      if (k.has('ArrowRight') || k.has('KeyD')) ph.yaw += dt * 1.2;
      if (k.has('ArrowUp') || k.has('KeyW')) ph.pitch = Math.min(1.45, ph.pitch + dt * 0.8);
      if (k.has('ArrowDown') || k.has('KeyS')) ph.pitch = Math.max(0.05, ph.pitch - dt * 0.8);
      const P = this.player;
      const cp = Math.cos(ph.pitch);
      cam.position.set(P.x + Math.sin(ph.yaw) * cp * ph.dist, 0.6 + Math.sin(ph.pitch) * ph.dist, P.z + Math.cos(ph.yaw) * cp * ph.dist);
      cam.lookAt(P.x, 1, P.z);
      cam.clearViewOffset();
      // depth of field pulled onto the ship
      this.r.bokeh.enabled = ph.dof && this.r.quality !== 'low';
      const bu = this.r.bokeh.uniforms as Record<string, { value: number }>;
      bu.focus.value = cam.position.distanceTo(this.hazeV.set(P.x, 1, P.z));
      bu.aperture.value = ph.aperture;
      bu.maxblur.value = 0.012;
      return;
    }
    if (this.state === 'menu' && this.hangarOpen) {
      const a = this.time * 0.25;
      // a low, close hero angle so the ship (not the pad's near rim) owns the frame
      const dist = this.r.width > this.r.height ? 8.8 : 16.5;
      this.camPos.set(Math.sin(a) * dist, 4.6 + (dist - 8.8) * 0.3, Math.cos(a) * dist);
      cam.position.lerp(this.camPos, 1 - Math.exp(-3 * dt));
      this.camLook.set(0, this.showY - 0.1, 0);
      cam.lookAt(this.camLook);
      const bu = this.r.bokeh.uniforms as Record<string, { value: number }>;
      bu.focus.value = cam.position.distanceTo(this.camLook);
      bu.aperture.value = 0.0005;
      bu.maxblur.value = 0.006;
      const W = this.r.width, H = this.r.height;
      if (W > H) cam.setViewOffset(W, H, W * 0.2, 0, W, H);
      else cam.setViewOffset(W, H, 0, H * 0.27, W, H);
      return;
    }
    if (this.state === 'menu' && this.r.width > this.r.height * 1.1 && this.r.width > 760) {
      cam.setViewOffset(this.r.width, this.r.height, -this.r.width * 0.16, 0, this.r.width, this.r.height);
    } else cam.clearViewOffset();
    if (this.state === 'menu') {
      if (this.showShip) {
        this.showShip.rotation.y = this.time * 0.5;
        this.showShip.position.y = 2.2 + Math.sin(this.time * 1.5) * 0.2;
      }
      // title flythrough: a slow loop that dips low over the colony, sweeps the mountains, returns to the pad
      const T = (this.time * 0.012) % 1;
      this.menuPath.getPointAt(T, this.camPos);
      this.menuLook.getPointAt(T, this.camLook);
      cam.position.lerp(this.camPos, 1 - Math.exp(-1.5 * dt));
      this.lookSmooth.lerp(this.camLook, 1 - Math.exp(-1.5 * dt));
      cam.lookAt(this.lookSmooth);
      this.r.sun.target.position.set(0, 0, 0);
      this.r.sun.position.copy(this.sunOff);
      return;
    }
    const P = this.player;
    const be = this.boss.e;
    if (P.dead && this.deathT > 0 && this.state === 'play') {
      // death cam: low, slow push around the wreck
      const a = this.time * 0.35;
      this.camPos.set(P.x + Math.sin(a) * 11, 5, P.z + Math.cos(a) * 11);
      cam.position.lerp(this.camPos, 1 - Math.exp(-2.5 * dt));
      this.camLook.set(P.x, 1, P.z);
      cam.lookAt(this.camLook);
      document.body.classList.add('cine');
      return;
    }
    if (this.victoryT > 0) {
      document.body.classList.add('cine');
      const a = this.time * 0.5;
      this.camPos.set(P.x + Math.sin(a) * 18, 10, P.z + Math.cos(a) * 18);
      cam.position.lerp(this.camPos, 1 - Math.exp(-2 * dt));
      this.camLook.set(P.x, 3, P.z);
      cam.lookAt(this.camLook);
      return;
    }
    if (this.cineT > 0 && be) {
      const by = this.boss.body ? this.boss.body.position.y : 3;
      this.camPos.set(be.x + 5, 7, be.z + 16);
      cam.position.lerp(this.camPos, 1 - Math.exp(-3 * dt));
      this.camLook.set(be.x, Math.max(3, by * 0.8), be.z);
      cam.lookAt(this.camLook);
      return;
    }
    // portrait screens need more height to see sideways
    const zoom = aspect < 1 ? Math.pow(1 / aspect, 0.55) : 1;
    const bossZoom = this.boss.e ? 1.15 : 1;
    const h = 24 * zoom * bossZoom;
    const lead = 1.2;
    const tx = P.x + P.vx * 0.12 * lead;
    const tz = P.z + P.vz * 0.12 * lead;
    this.camPos.set(tx, h, tz + h * 0.62);
    cam.position.lerp(this.camPos, this.snapCam ? 1 : 1 - Math.exp(-6 * dt));
    this.snapCam = false;
    let sx = 0, sy = 0;
    if (this.shake > 0 && this.settings.shake && !this.settings.calm) {
      const s = this.shake * this.shake * 1.4;
      sx = rand(-s, s);
      sy = rand(-s, s);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.camLook.set(cam.position.x + sx, 0, cam.position.z - h * 0.62 + sy);
    // hit-stop punch-in: a quick narrowing of the lens that drifts toward the moment, then eases out
    if (this.punch > 0.001 && !this.settings.calm) {
      const k = this.punch * this.punch * (3 - 2 * this.punch);
      this.camLook.x += (this.punchX - this.camLook.x) * 0.18 * k;
      this.camLook.z += (this.punchZ - this.camLook.z) * 0.18 * k;
    }
    cam.lookAt(this.camLook);
    // keep the shadow frustum centred on the action, snapped to whole shadow texels in light
    // space so shadow edges don't crawl and shimmer while the camera glides
    this.placeShadow(P.x, P.z);
  }

  private punch = 0;
  private punchX = 0;
  private punchZ = 0;
  private realDt = 0.016;
  /** Lens punch toward a world point; stacks up to 1. */
  punchAt(x: number, z: number, amount: number) {
    if (amount < this.punch) return;
    this.punch = Math.min(1, amount);
    this.punchX = x;
    this.punchZ = z;
  }

  private shX = new THREE.Vector3();
  private shY = new THREE.Vector3();
  private shZ = new THREE.Vector3();
  private shC = new THREE.Vector3();
  private placeShadow(x: number, z: number) {
    const sun = this.r.sun;
    const sc = sun.shadow.camera;
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    const Z = this.shZ.copy(this.sunOff).normalize();
    const X = this.shX.set(0, 1, 0).cross(Z).normalize();
    const Y = this.shY.copy(Z).cross(X);
    const c = this.shC.set(x, 0, z);
    const u = Math.round(c.dot(X) / texel) * texel;
    const v = Math.round(c.dot(Y) / texel) * texel;
    const w = c.dot(Z);
    c.set(0, 0, 0).addScaledVector(X, u).addScaledVector(Y, v).addScaledVector(Z, w);
    sun.target.position.copy(c);
    sun.position.copy(c).add(this.sunOff);
  }

  /* ======================= simulation ======================= */

  private update(dt: number) {
    const P = this.player;
    this.T += P.dead ? 0 : dt;

    if (!P.dead) {
      if (P.update(dt, this.input, this.time)) this.onDash();
      if (P.hitWall) this.arena.wallImpact(P.x, P.z, this.time);
      // hull damage: sparks and smoke when critical
      const hpK = P.hp / P.maxHp;
      if (hpK < 0.35 && Math.random() < (0.35 - hpK) * 2.2) {
        this.particles.emit(P.x + rand(-0.6, 0.6), 1.1, P.z + rand(-0.6, 0.6), rand(-3, 3), rand(2, 5), rand(-3, 3), 0.35, 0.25, this.colors.orange, 2, -14);
        if (Math.random() < 0.4) this.smoke.trail(P.x, 1.2, P.z, 0.7, 0.9);
      }
      if (P.dashing) this.particles.emit(P.x, 0.8, P.z, rand(-1, 1), 0.5, rand(-1, 1), 0.35, 0.9, this.colors.cyan, 3);
      // engine trail
      const sp = Math.hypot(P.vx, P.vz);
      if (sp > 1 && chance(0.8)) {
        const bx = P.x - Math.sin(P.ang) * 1.2, bz = P.z - Math.cos(P.ang) * 1.2;
        this.particles.emit(bx, 0.9, bz, -P.vx * 0.1 + rand(-0.4, 0.4), rand(0, 0.4), -P.vz * 0.1 + rand(-0.4, 0.4), 0.45, 0.45, this.colors.cyan, 3);
      }
      // the swarm stays broken while the victory fireworks play
      if (this.victoryT <= 0) this.director(dt);
      this.weapons.update(dt);
    } else {
      this.deathT -= dt;
      if (this.deathT <= 0) this.endRun(false);
    }

    for (let i = this.timed.length - 1; i >= 0; i--) {
      const q = this.timed[i];
      q.t -= dt;
      if (q.t <= 0) { this.timed.splice(i, 1); q.fn(); }
    }
    this.enemies.update(dt);
    this.proj.update(dt);
    this.hazards.update(dt, this.time);
    this.pickups.update(dt);
    this.particles.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
    this.fx.update(dt, this.r.width, this.r.height);

    // combo decay
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    this.tutorial();
    this.weather(dt);
    this.updateDevils(dt);

    // achievements
    if (!P.dead) this.untouchedT += dt;
    this.achT -= dt;
    if (this.achT <= 0) {
      this.achT = 0.5;
      this.checkAch();
    }

    // heartbeat when hull is critical
    if (!P.dead && P.hp / P.maxHp < 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.55 + (P.hp / P.maxHp) * 2;
        this.audio.sfx('heart');
      }
    }

    // music intensity
    this.audio.intensity = this.boss.e ? 3 : this.T > 240 ? 2 : this.T > 60 ? 1 : 0;

    // victory sequence: fireworks over the colony
    if (this.victoryT > 0) {
      if (Math.random() < dt * 3.5) {
        const a = rand(0, TAU), d = rand(6, 22);
        const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d, y = rand(6, 12);
        const cols = [this.colors.cyan, this.colors.pink, this.colors.yellow, this.colors.violet, this.colors.green];
        const c = cols[Math.floor(Math.random() * cols.length)];
        for (let k = 0; k < 30; k++) {
          const u = rand(-1, 1), th = rand(0, TAU), sp = rand(7, 10);
          const rr = Math.sqrt(1 - u * u);
          this.particles.emit(x, y, z, rr * Math.cos(th) * sp, u * sp, rr * Math.sin(th) * sp, rand(0.9, 1.4), 0.32, c, 1.6, -5);
        }
        this.lighting.flash(x, z, c, 12, 22, 0.5);
        this.audio.sfx('kill');
      }
      this.victoryT -= dt;
      if (this.victoryT <= 0) this.endRun(true);
    }

    // HUD
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.05;
      this.ui.updateHud({
        hp: P.hp, maxHp: P.maxHp, xp: P.xp, xpNext: P.xpNext, level: P.level, time: this.T, kills: this.kills, score: this.score,
        combo: this.combo, dashFrac: 1 - P.dashCD / P.dashMax, won: this.won, endless: this.endless,
        weapons: P.weapons, passives: P.passives, evolved: P.evolved,
      });
      const b = this.boss.e;
      this.ui.setBoss(b ? this.boss.name : null, b ? b.hp / b.maxHp : 0);
    }
    // off-screen threat arrows
    {
      const pts: { x: number; y: number; boss: boolean }[] = [];
      const v = new THREE.Vector3();
      for (const e of this.enemies.list) {
        if (e.type !== 'boss' && !e.elite) continue;
        v.set(e.x, 1, e.z).project(this.r.camera);
        if (Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02 || v.z > 1) {
          if (v.z > 1) { v.x *= -1; v.y *= -1; }
          pts.push({ x: v.x, y: v.y, boss: e.type === 'boss' });
        }
      }
      this.ui.threats(pts);
    }
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 1 / 30;
      this.ui.minimap({
        px: P.x, pz: P.z, ang: P.ang,
        enemies: this.enemies.list.map((e) => ({ x: e.x, z: e.z, boss: e.type === 'boss', elite: e.elite })),
        powers: this.pickups.powers.map((p) => ({ x: p.x, z: p.z })),
      });
    }

    if (this.pendingLevels > 0 && !P.dead && this.state === 'play' && this.victoryT <= 0) this.openLevelUp();
  }

  private director(dt: number) {
    const T = this.T;
    // bosses
    if (!this.boss.e && this.bossWarn <= 0 && T >= this.nextBoss) {
      this.pendingFinal = !this.won && !this.endless && this.nextBoss >= FINAL_TIME;
      this.bossWarn = 3;
      this.ui.banner('⚠ WARNING ⚠', this.pendingFinal ? 'THE PRISM CORE DESCENDS' : 'MOTHERSHIP INBOUND', '#ff4f7b', 3000);
      this.audio.sfx('warn');
    }
    if (this.bossWarn > 0) {
      this.bossWarn -= dt;
      if (this.bossWarn <= 0) {
        this.boss.spawn(this.pendingFinal);
        this.cineT = 3.4;
        this.ui.bossCard(this.boss.name, this.pendingFinal ? 'FINAL BATTLE' : tf('MOTHERSHIP {0}', ['I', 'II', 'III', 'IV', 'V'][this.bossesKilled] ?? this.bossesKilled + 1));
        if (this.endless || this.won) this.nextBoss = T + 100;
        else {
          const idx = BOSS_TIMES.indexOf(this.nextBoss);
          this.nextBoss = idx >= 0 && idx < BOSS_TIMES.length - 1 ? BOSS_TIMES[idx + 1] : this.nextBoss < FINAL_TIME ? FINAL_TIME : Infinity;
        }
      }
    }

    // regular spawns
    const rate = Math.min(22, 0.9 + T / 42 + Math.pow(T / 120, 2)) * (this.boss.e ? 0.22 : 1) * (this.endless ? 1.3 : 1) * (this.night ? 1.15 : 1) * (this.mods.has('tide') ? 1.4 : 1);
    this.spawnAcc += rate * dt;
    let guard = 0;
    while (this.spawnAcc >= 1 && guard++ < 20) {
      this.spawnAcc -= 1;
      if (this.enemies.count() >= 520) break;
      const type = this.pickType();
      const p = this.spawnPoint(24, 31);
      this.enemies.spawn(type, p.x, p.z);
    }

    // swarm surges: a closing ring around the player
    if (T >= this.nextSurge) {
      this.nextSurge += 52;
      if (!this.boss.e && this.bossWarn <= 0) {
        const n = Math.min(42, 14 + Math.floor(T / 12));
        const type: EType = T > 200 && chance(0.5) ? 'shard' : 'drone';
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          let x = this.player.x + Math.cos(a) * 17, z = this.player.z + Math.sin(a) * 17;
          const d = Math.hypot(x, z);
          if (d > ARENA_RADIUS - 2) {
            x *= (ARENA_RADIUS - 2) / d;
            z *= (ARENA_RADIUS - 2) / d;
          }
          this.enemies.spawn(type, x, z);
        }
        this.ui.banner('SWARM SURGE', 'Break through the ring', '#ff4fd8', 1800);
        this.audio.sfx('spawn');
      }
    }

    // elites: tougher golden variants that always drop supplies
    // (held back while a mothership is announcing or making its entrance)
    if (T >= this.nextElite && this.bossWarn <= 0 && this.cineT <= 0) {
      this.nextElite += this.mods.has('elites') ? 35 : 70;
      const pool: EType[] = T > 240 ? ['brute', 'wraith', 'spitter'] : ['brute', 'spitter', 'meteor'];
      const p = this.spawnPoint(20, 26);
      const e = this.enemies.spawn(pool[Math.floor(Math.random() * pool.length)], p.x, p.z, true);
      if (e) this.ui.banner('ELITE DETECTED', tf('{0} {1} · drops supplies', t({ shielded: 'Shielded', regen: 'Regenerating', volatile: 'Volatile' }[e.affix as 'shielded'] ?? 'Golden'), e.def.name), '#ffd84f', 1800);
    }
  }

  private pickType(): EType {
    const T = this.T;
    const w: [EType, number][] = [['drone', 10]];
    if (T > 35) w.push(['dart', 2 + T / 60]);
    if (T > 65) w.push(['meteor', 2 + T / 90]);
    if (T > 95) w.push(['spitter', 1.5 + T / 110]);
    if (T > 130) w.push(['brute', 0.8 + T / 160]);
    const n = this.night;
    if (T > (n ? 110 : 200)) w.push(['wraith', 1 + T / 120]);
    if (T > (n ? 100 : 170)) w.push(['bomber', 1.2 + T / 160]);
    if (T > 240 && this.enemies.count('turret') < 3 + Math.floor(T / 120)) w.push(['turret', 0.35]);
    return pickWeighted(w);
  }

  spawnPoint(minD: number, maxD: number, angle?: number) {
    const P = this.player;
    const lim = ARENA_RADIUS - 2.5;
    for (let i = 0; i < 12; i++) {
      const a = angle ?? rand(0, TAU);
      const d = rand(minD, maxD);
      const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < lim) return { x, z };
      angle = undefined;
    }
    // fall back to the far side of the arena from the player
    const a = Math.atan2(-P.z, -P.x) + rand(-0.6, 0.6);
    return { x: Math.cos(a) * lim * 0.85, z: Math.sin(a) * lim * 0.85 };
  }

  /* ======================= combat ======================= */

  damage(e: Enemy, amt: number, kx: number, kz: number, src = '') {
    if (e.dead) return;
    const crit = chance(0.08);
    if (crit) amt *= 2;
    if (e.shield > 0) {
      // shield soaks damage first and sparks blue
      const soak = Math.min(e.shield, amt);
      e.shield -= soak;
      amt -= soak;
      this.particles.emit(e.x, e.def.hover + 0.5, e.z, rand(-3, 3), rand(1, 3), rand(-3, 3), 0.25, 0.35, this.colors.cyan, 3);
      if (e.shield <= 0) {
        this.fx.ring(e.x, e.z, e.r * 3, 0x6fd8ff, 0.35, 2);
        this.particles.burst(e.x, e.def.hover + 0.5, e.z, this.colors.cyan, 24, 8, 0.4, 0.5);
        this.audio.sfx('zap');
      }
      if (amt <= 0) { e.flash = 0.05; return; }
    }
    e.hp -= amt;
    this.damageDealt += amt;
    e.flash = 0.08;
    const heavy = e.type === 'boss' ? 0.05 : e.type === 'turret' ? 0 : e.type === 'brute' || e.elite ? 0.3 : 1;
    e.kx += kx * heavy;
    e.kz += kz * heavy;
    if (this.settings.numbers && (crit || amt >= 40 || chance(0.12)) && this.fx.floaters.filter((f) => f.active).length < 22) {
      this.fx.text(e.x, 2.2, e.z, String(Math.round(amt)), crit ? 'crit' : src);
    }
    this.audio.sfx('hit');
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: Enemy) {
    e.dead = true;
    if (e.type === 'boss') {
      this.bossDeath(e);
      return;
    }
    if (!this.meta.seen.includes(e.type)) this.meta.seen.push(e.type);
    this.enemies.addCorpse(e, e.kx * 0.3, e.kz * 0.3);
    this.kills++;
    this.combo++;
    this.comboT = 2.6;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(e.def.score * (1 + Math.floor(this.combo / 10) * 0.2) * (e.elite ? 10 : 1) * this.scoreMult);
    const col = new THREE.Color(e.def.color).multiplyScalar(3);
    const big = e.type === 'brute' || e.elite;
    this.particles.burst(e.x, e.def.hover + 0.3, e.z, col, big ? 40 : 14, big ? 12 : 8, 0.6, big ? 1 : 0.6, 0.6);
    this.particles.burst(e.x, e.def.hover + 0.3, e.z, this.colors.white, big ? 10 : 4, 5, 0.25, 0.8, 0.3);
    this.debris.spawn(e.x, e.def.hover, e.z, this.colors.debris, big ? 10 : 3, big ? 9 : 6, big ? 1.4 : 0.8);
    if (e.elite) {
      this.freezeT = Math.max(this.freezeT, 0.06);
      this.punchAt(e.x, e.z, 0.6);
    }
    if (e.affix === 'volatile') {
      // volatile elites detonate: big blast that hurts nearby enemies and the player
      this.hazards.blast(e.x, e.z, 5.5, 0.7, e.dmg * 1.2, 0xff4a2a);
    }
    this.smoke.puff(e.x, e.def.hover, e.z, big ? 7 : 2, big ? 1.4 : 0.6, big ? 1.8 : 1.0);
    if (big) this.particles.fireball(e.x, e.def.hover, e.z, 1.2, 12);
    if (big) {
      this.fx.shock(e.x, e.z, 6, 0.8, 0.45);
      this.lighting.flash(e.x, e.z, 0xff9a50, 40, 14, 0.4);
      this.fx.ring(e.x, e.z, 4, e.def.color, 0.4, 3);
      this.fx.scorch(e.x, e.z, 2.5);
      this.shake = Math.max(this.shake, 0.4);
      this.audio.sfx('boom');
    } else this.audio.sfx('kill');

    // loot
    this.pickups.dropGem(e.x, e.z, e.def.xp * (e.elite ? 12 : 1));
    if (e.elite) {
      const kinds: PowerKind[] = this.mods.has('norepair') ? ['magnet', 'bomb'] : ['heal', 'magnet', 'bomb'];
      this.pickups.dropPower(kinds[Math.floor(Math.random() * kinds.length)], e.x + 1, e.z);
    } else {
      const r = Math.random();
      if (r < 0.011) { if (!this.mods.has('norepair')) this.pickups.dropPower('heal', e.x, e.z); }
      else if (r < 0.0145) this.pickups.dropPower('magnet', e.x, e.z);
      else if (r < 0.017) this.pickups.dropPower('bomb', e.x, e.z);
    }

    if (e.type === 'meteor') {
      for (let i = 0; i < 3; i++) {
        const a = rand(0, TAU);
        const s = this.enemies.spawn('shard', e.x + Math.cos(a) * 0.6, e.z + Math.sin(a) * 0.6);
        if (s) {
          s.spawnT = 0;
          s.kx = Math.cos(a) * 9;
          s.kz = Math.sin(a) * 9;
        }
      }
    }
    const tiers: Record<number, string> = { 50: 'RAMPAGE', 100: 'UNSTOPPABLE', 200: 'PRISM FURY', 400: 'GODLIKE', 800: 'SUPERNOVA' };
    if (tiers[this.combo]) {
      this.ui.banner(tiers[this.combo], `${this.combo} combo · +${(this.combo * 25).toLocaleString()}`, '#ffd84f', 1500);
      this.score += this.combo * 25;
      this.audio.sfx('level');
    }
  }

  private bossDeath(e: Enemy) {
    const final = this.boss.final;
    const bossKey = 'boss' + (final ? 3 : this.boss.index % 3);
    if (!this.meta.seen.includes(bossKey)) this.meta.seen.push(bossKey);
    this.bossesKilled++;
    this.kills++;
    this.score += final ? 25000 : 4000 * this.bossesKilled;
    const col = this.boss.color.clone().multiplyScalar(3);
    this.freezeT = 0.1;
    this.slowT = 1.4;
    if (this.boss.e) this.punchAt(this.boss.e.x, this.boss.e.z, 1);
    this.shake = 1.6;
    this.ui.flash();
    this.audio.sfx('bossdie');
    for (let i = 0; i < 5; i++) {
      const ox = rand(-3, 3), oz = rand(-3, 3);
      this.particles.burst(e.x + ox, 2, e.z + oz, col, 26, 22, 1.2, 1.0, 0.9);
    }
    this.fx.ring(e.x, e.z, 16, this.boss.color, 0.9, 1.6);
    this.fx.ring(e.x, e.z, 26, this.boss.color, 1.2, 1.0);
    this.particles.burst(e.x, 2, e.z, this.colors.white, 30, 16, 0.8, 0.9, 0.8);
    this.fx.shock(e.x, e.z, 40, 2.2, 1.4);
    this.lighting.flash(e.x, e.z, this.boss.color, 160, 45, 1.6);
    this.fx.shock(e.x, e.z, 22, 1.5, 0.9);
    for (let i = 0; i < 4; i++) this.particles.fireball(e.x + rand(-3, 3), 2, e.z + rand(-3, 3), 3, 22);
    this.smoke.puff(e.x, 1.5, e.z, 18, 3, 2.8);
    this.debris.spawn(e.x, 2, e.z, this.colors.debris, 40, 14, 2);
    this.fx.scorch(e.x, e.z, 7);
    this.bossSignatureDeath(e, final);
    this.proj.clearEnemyShots();
    this.hazards.clear();
    this.boss.clear();
    // treasure: a fountain of crystals worth ~2 levels
    const total = this.player.xpNext * 2.2 + xpForLevel(this.player.level + 1);
    for (let i = 0; i < 18; i++) this.pickups.dropGem(e.x + rand(-2, 2), e.z + rand(-2, 2), Math.ceil(total / 18));
    if (!this.mods.has('norepair')) this.pickups.dropPower('heal', e.x + 2, e.z);
    this.pickups.dropPower('magnet', e.x - 2, e.z);
    if (final && !this.won) {
      this.won = true;
      this.victoryT = 5;
      this.ui.banner('CORE DESTROYED', 'The colony is saved', '#7ff6ff', 3200);
      setTimeout(() => this.audio.sfx('victory'), 900);
      // shatter every remaining enemy
      for (const o of this.enemies.list) if (!o.dead) this.kill(o);
    } else {
      this.ui.banner('MOTHERSHIP DOWN', `+${(4000 * this.bossesKilled).toLocaleString()} score`, '#c86bff', 2200);
    }
  }

  /** Seeker mine explosion: hurts the player if close, always dies. */
  detonate(e: Enemy) {
    if (e.dead) return;
    e.dead = true;
    const P = this.player;
    const r = 3.2;
    const col = new THREE.Color(1, 0.25, 0.2).multiplyScalar(3);
    this.particles.burst(e.x, 1, e.z, col, 30, 12, 0.5, 0.9, 0.5);
    this.particles.fireball(e.x, 1, e.z, 1.4, 14);
    this.lighting.flash(e.x, e.z, 0xff5030, 45, 14, 0.4);
    this.smoke.puff(e.x, 1, e.z, 8, 1.5, 1.8);
    this.fx.ring(e.x, e.z, r, 0xff3a2a, 0.35, 3);
    this.fx.scorch(e.x, e.z, 2.2);
    this.audio.sfx('boom');
    this.shake = Math.max(this.shake, 0.45);
    if (!P.dead && Math.hypot(P.x - e.x, P.z - e.z) < r + P.r) this.hurtPlayer(e.dmg, null);
  }

  /** Each mothership dies in its own way. */
  private bossSignatureDeath(e: Enemy, final: boolean) {
    const kind = final ? 3 : this.boss.index % 3;
    const yaw = e.yaw, ex = e.x, ez = e.z;
    const col = this.boss.color.clone();
    if (kind === 0) {
      // Vanguard Carrier: a chain of secondary explosions rips along its hull
      for (let i = 0; i < 7; i++) {
        const t = (i - 3) * 1.6;
        this.after(0.12 + i * 0.13, () => {
          const x = ex + Math.sin(yaw) * t, z = ez + Math.cos(yaw) * t;
          this.particles.fireball(x, 2, z, 1.6, 14);
          this.smoke.puff(x, 2, z, 6, 1.6, 2.4);
          this.debris.spawn(x, 2, z, this.colors.debris, 6, 10, 1.6);
          this.fx.shock(x, z, 8, 0.8, 0.4);
          this.lighting.flash(x, z, 0xff8a40, 40, 16, 0.4);
          this.audio.sfx('boom');
          this.shake = Math.max(this.shake, 0.7);
        });
      }
    } else if (kind === 1) {
      // Hive Dreadnought: bursts open and its unborn swarm scatters and dissolves
      for (let i = 0; i < 40; i++) {
        const a = rand(0, TAU), sp = rand(8, 20);
        const fake = { type: 'drone', def: ED.drone, x: ex, z: ez, yaw: a, tumble: 0, elite: false, vx: 0, vz: 0 } as unknown as Enemy;
        this.enemies.addCorpse(fake, Math.cos(a) * sp, Math.sin(a) * sp);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        this.hazards.pool(ex + Math.cos(a) * 6, ez + Math.sin(a) * 6, 2.6, 0.3, 3, 0, 0x5dff3a);
      }
      this.particles.burst(ex, 2, ez, new THREE.Color(0.3, 1, 0.4).multiplyScalar(1.4), 40, 18, 1, 0.6, 1);
    } else if (kind === 2) {
      // Obsidian Warden: shatters like glass
      const glass = new THREE.Color(0.9, 0.95, 1);
      this.debris.spawn(ex, 3, ez, glass, 70, 22, 1.8);
      for (let i = 0; i < 10; i++) {
        const a = rand(0, TAU), l = rand(8, 18);
        this.fx.lightning([new THREE.Vector3(ex, 2, ez), new THREE.Vector3(ex + Math.cos(a) * l * 0.5, 1, ez + Math.sin(a) * l * 0.5), new THREE.Vector3(ex + Math.cos(a) * l, 0.2, ez + Math.sin(a) * l)], col.getHex(), 0.6);
      }
      this.particles.burst(ex, 3, ez, new THREE.Color(1, 1, 1).multiplyScalar(1.4), 40, 24, 0.6, 0.35, 1);
    } else {
      // Prism Core: implodes, then releases a prismatic supernova
      this.fx.ring(ex, ez, 30, 0xffffff, 0.5, 2);
      this.after(0.6, () => {
        const hues = [0x5ef2ff, 0xff4fd8, 0xffd84f, 0x7dff9b, 0xb48bff];
        hues.forEach((h, i) => this.fx.ring(ex, ez, 30 + i * 12, h, 1.2 + i * 0.25, 1.2));
        this.fx.shock(ex, ez, 60, 2.5, 1.6);
        this.ui.flash('rgba(255,255,255,0.9)');
        for (const h of hues) this.particles.burst(ex, 6, ez, new THREE.Color(h).multiplyScalar(2.2), 40, 26, 1.4, 0.9, 1);
        this.lighting.flash(ex, ez, 0xffffff, 250, 80, 2);
        this.audio.sfx('bomb');
      });
    }
    void col;
  }

  hurtPlayer(dmg: number, src: Enemy | null) {
    const P = this.player;
    if (P.inv > 0 || P.dead || this.victoryT > 0) return;
    const amt = Math.max(1, dmg - P.armor);
    this.untouchedT = -1e9;
    const key = src ? src.type : 'bullet';
    this.dmgLog[key] = (this.dmgLog[key] ?? 0) + amt;
    P.hp -= amt;
    P.inv = 0.5;
    this.hurtT = 0.25;
    this.shake = Math.max(this.shake, 0.55);
    this.audio.sfx('hurt');
    this.combo = 0;
    try {
      navigator.vibrate?.(40);
    } catch {
      /* ignore */
    }
    this.particles.burst(P.x, 1, P.z, this.colors.red, 16, 8, 0.4, 0.6);
    if (src && src.type !== 'boss') {
      const dx = src.x - P.x, dz = src.z - P.z;
      const d = Math.hypot(dx, dz) || 1;
      src.kx += (dx / d) * 12;
      src.kz += (dz / d) * 12;
    }
    if (P.hp <= 0) this.playerDeath();
  }

  private playerDeath() {
    const P = this.player;
    if (P.revives > 0) {
      P.revives--;
      P.hp = P.maxHp * 0.5;
      P.inv = 3;
      this.freezeT = 0.15;
      this.punchAt(P.x, P.z, 0.8);
      this.ui.flash('rgba(255,180,90,0.7)');
      this.ui.banner('PHOENIX PROTOCOL', 'Hull restored · one life left', '#ffb347', 2200);
      this.audio.sfx('evolve');
      for (const e of this.enemies.query(P.x, P.z, 14)) if (!e.dead && e.type !== 'boss') this.damage(e, 99999, 0, 0);
      this.proj.clearEnemyShots();
      this.fx.ring(P.x, P.z, 14, 0xffb347, 0.8, 3);
      this.particles.ring(P.x, 0.6, P.z, this.colors.orange, 60, 16, 0.6, 0.8);
      return;
    }
    P.hp = 0;
    P.dead = true;
    P.root.visible = false;
    P.magnetRing.visible = false;
    for (const t of P.trails) t.visible = false;
    this.deathT = 2.2;
    this.slowT = 1.6;
    this.shake = 1.4;
    this.ui.flash('rgba(255,80,80,0.6)');
    this.audio.sfx('bossdie');
    this.particles.burst(P.x, 1, P.z, this.colors.cyan, 90, 18, 1.2, 1.2, 0.8);
    this.particles.burst(P.x, 1, P.z, this.colors.orange, 60, 12, 1, 1, 0.8);
    this.debris.spawn(P.x, 1, P.z, new THREE.Color(0.9, 0.9, 0.95), 24, 12, 1.4);
    this.particles.fireball(P.x, 1, P.z, 2.2, 26);
    this.fx.shock(P.x, P.z, 20, 1.8, 1.0);
    this.lighting.flash(P.x, P.z, 0x6ff0ff, 120, 30, 1.2);
    this.smoke.puff(P.x, 1, P.z, 24, 2.5, 3);
    this.fx.ring(P.x, P.z, 14, 0x5ef2ff, 1, 4);
    this.fx.scorch(P.x, P.z, 4);
  }

  private onDash() {
    const P = this.player;
    this.fx.shock(P.x, P.z, 5, 0.6, 0.3);
    this.audio.sfx('dash');
    this.fx.ring(P.x, P.z, 3, 0x5ef2ff, 0.3, 1.5);
    this.particles.ring(P.x, 0.6, P.z, this.colors.cyan, 24, 7, 0.3, 0.45);
  }

  gainXp(v: number) {
    const P = this.player;
    v *= P.xpMul;
    P.xp += v;
    this.score += v;
    while (P.xp >= P.xpNext) {
      P.xp -= P.xpNext;
      P.level++;
      P.xpNext = xpForLevel(P.level);
      this.pendingLevels++;
    }
  }

  collectPower(kind: PowerKind, x: number, z: number) {
    const P = this.player;
    if (kind === 'heal') {
      P.hp = Math.min(P.maxHp, P.hp + 40 + P.maxHp * 0.15);
      this.audio.sfx('heal');
      this.particles.burst(x, 1, z, this.colors.red, 30, 6, 0.8, 0.6, 1);
      this.fx.text(x, 2.5, z, 'REPAIRED', 'big heal');
    } else if (kind === 'magnet') {
      this.pickups.magnetAll();
      this.audio.sfx('heal');
      this.fx.ring(x, z, 20, 0x4fffe0, 0.7, 3);
      this.fx.text(x, 2.5, z, 'TRACTOR PULSE', 'big');
    } else {
      this.audio.sfx('bomb');
      this.fx.shock(x, z, 45, 2.5, 1.3);
      this.lighting.flash(x, z, 0xffb060, 200, 60, 1.2);
      this.ui.flash('rgba(255,200,120,0.75)');
      this.shake = 1.3;
      this.fx.ring(x, z, 34, 0xffaa33, 1.0, 4);
      this.fx.ring(x, z, 24, 0xffffff, 0.8, 3);
      this.arena.groundUniforms.uPulse.value = 1.5;
      for (const e of this.enemies.list) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - x, e.z - z);
        if (d < 34) this.damage(e, e.type === 'boss' ? 300 : 99999, 0, 0);
      }
      this.proj.clearEnemyShots();
      this.fx.text(x, 2.5, z, 'PAYLOAD DELIVERED', 'big');
    }
  }

  /* ======================= level up ======================= */

  private openLevelUp() {
    this.state = 'levelup';
    this.input.releaseAll();
    this.audio.sfx('level');
    this.choices = rollChoices(this.player);
    this.showChoices();
    const P = this.player;
    // level-up burst: a rising column of light and a gold shock ring
    this.particles.ring(P.x, 0.6, P.z, this.colors.yellow, 40, 10, 0.5, 0.6);
    for (let k = 0; k < 40; k++) {
      const a = rand(0, TAU), r = rand(0.2, 1.4);
      this.particles.emit(P.x + Math.cos(a) * r, 0.3, P.z + Math.sin(a) * r, 0, rand(6, 14), 0, rand(0.5, 0.9), 0.35, this.colors.yellow, 1.2, 0);
    }
    this.fx.ring(P.x, P.z, 6, 0xffd84f, 0.5, 1.6);
    this.fx.shock(P.x, P.z, 7, 0.6, 0.4);
    this.lighting.flash(P.x, P.z, 0xffd84f, 30, 16, 0.5);
  }

  private showChoices() {
    const views = this.choices.map((c) => describe(c, this.player));
    this.ui.showLevelUp(this.player.level, views, this.rerolls, (i) => this.choose(i), () => this.reroll());
  }

  private reroll() {
    if (this.rerolls <= 0) return;
    this.rerolls--;
    this.audio.sfx('select');
    this.choices = rollChoices(this.player);
    this.showChoices();
  }

  private choose(i: number) {
    const c = this.choices[i];
    if (!c) return;
    const res = applyChoice(c, this.player);
    if (res.score) this.score += res.score;
    this.audio.sfx(c.kind === 'evolve' ? 'evolve' : 'select');
    if (c.kind === 'evolve') {
      this.ui.banner('EVOLUTION', describe(c, this.player).name.toUpperCase(), describe(c, this.player).color, 2000);
      const P = this.player;
      const col = new THREE.Color(describe(c, P).color);
      // evolution cutscene: freeze, white flash, prismatic shock rings, a burst in the weapon's colour
      this.freezeT = 0.25;
      this.slowT = 0.9;
      this.punchAt(P.x, P.z, 0.9);
      this.ui.flash('rgba(255,250,235,0.85)');
      for (let i = 0; i < 3; i++) this.fx.ring(P.x, P.z, 8 + i * 6, [0xffd84f, 0xff4fd8, 0x5ef2ff][i], 0.7 + i * 0.2, 2);
      this.fx.shock(P.x, P.z, 22, 1.6, 0.9);
      this.particles.burst(P.x, 1, P.z, col.clone().multiplyScalar(2.5), 70, 14, 1, 0.7, 1);
      this.lighting.flash(P.x, P.z, col, 90, 30, 1.0);
      this.shake = Math.max(this.shake, 0.6);
    }
    this.pendingLevels--;
    this.player.inv = Math.max(this.player.inv, 0.8);
    if (!this.mods.has('norepair')) this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.08);
    this.state = 'play';
    this.last = performance.now();
  }

  /* ======================= dust devils ======================= */

  devils = [0, 1, 2].map((i) => ({ a: i * 2.1, r: 85 + i * 14, h: 0 }));
  private updateDevils(dt: number) {
    if (this.night) return;
    for (const d of this.devils) {
      d.a += dt * 0.035;
      d.h += dt * 7;
      const cx = Math.cos(d.a) * d.r, cz = Math.sin(d.a) * d.r;
      for (let k = 0; k < 2; k++) {
        const y = Math.random() * 14;
        const sp = d.h + y * 0.9;
        const rad = 0.6 + y * 0.35;
        this.smoke.trail(cx + Math.cos(sp) * rad, y, cz + Math.sin(sp) * rad, 1.2 + y * 0.18, 1.2);
      }
    }
  }

  /* ======================= weather ======================= */

  /** Periodic dust storm (ion storm with lightning at night): thick fog, wind-blown dust, reduced visibility. */
  private weather(dt: number) {
    const S = this.storm;
    if (S.dur <= 0 && this.T >= S.next && !this.boss.e && this.bossWarn <= 0) {
      S.dur = 32;
      S.t = 0;
      this.ui.banner(this.night ? 'ION STORM' : 'DUST STORM', 'Visibility dropping', this.night ? '#8ab0ff' : '#ffb27a', 2200);
      this.audio.sfx('nova');
    }
    let target = 0;
    if (S.dur > 0) {
      S.t += dt;
      target = S.t < S.dur - 4 ? 1 : 0;
      if (S.t >= S.dur) {
        S.dur = 0;
        S.next = this.T + 150 + Math.random() * 60;
      }
    }
    S.k += (target - S.k) * Math.min(1, dt * 0.6);
    this.applyStorm(S.k);
    if (S.k > 0.3) {
      const P = this.player;
      // wind-blown dust sheets drifting across the view
      if (Math.random() < S.k * 0.9) {
        const ox = rand(-28, 10), oz = rand(-22, 22);
        this.smoke.trail(P.x + ox, rand(0.5, 6), P.z + oz, rand(2.5, 5), rand(1.4, 2.4));
        if (Math.random() < 0.5) this.smoke.trail(P.x + ox + rand(-6, 6), rand(0.5, 6), P.z + oz + rand(-6, 6), rand(2.5, 5), rand(1.4, 2.4));
      }
      if (this.night) {
        S.flashT -= dt;
        if (S.flashT <= 0) {
          S.flashT = rand(2.5, 6);
          if (!this.settings.calm) this.ui.flash('rgba(160,190,255,0.35)');
          this.arena.groundUniforms.uPulse.value = 1.2;
          this.audio.sfx('boom');
        }
      }
    }
  }

  private applyStorm(k: number) {
    const fog = this.r.scene.fog as THREE.Fog;
    fog.near = 90 - k * 86;
    fog.far = 520 - k * 460;
    const st = this.smoke.mat.uniforms.uTint.value as THREE.Color;
    if (this.night) st.setRGB(0.32 - k * 0.1, 0.24 - k * 0.02, 0.22 + k * 0.15);
    else st.setRGB(0.32 + k * 0.25, 0.24 + k * 0.12, 0.22 + k * 0.04);
    this.smoke.wind = 0.6 + k * 14;
    const dm = this.arena.dust.material as THREE.PointsMaterial;
    dm.size = 0.12 + k * 0.18;
    dm.opacity = 0.55 + k * 0.35;
    this.arena.windBoost = 1 + k * 9;
  }

  /* ======================= first-run tutorial ======================= */

  private tutorial() {
    if (this.tutStep >= 99) return;
    const touch = this.input.touchUsed;
    const pad = this.input.gamepadUsed;
    const steps: [number, () => boolean, string][] = [
      [0, () => this.T > 0.5, touch ? '<b>Drag anywhere</b> to fly' : pad ? '<b>Left stick</b> to fly' : '<b>WASD</b> or <b>arrow keys</b> to fly'],
      [1, () => this.T > 5, 'Your weapons <b>fire automatically</b>. Focus on staying alive.'],
      [2, () => this.pickups.gems.length > 0 && this.T > 9, 'Grab the glowing <b>crystals</b> to level up'],
      [3, () => this.T > 16, touch ? 'Tap <b>DASH</b> to phase through enemies and bullets' : pad ? 'Press <b>A</b> to dash through enemies and bullets' : 'Press <b>SPACE</b> to dash through enemies and bullets'],
      [4, () => this.T > 26, 'Bosses land at <b>2:30</b>, <b>5:00</b> and <b>7:30</b>. Survive to <b>10:00</b>.'],
    ];
    const s = steps.find((x) => x[0] === this.tutStep);
    if (!s) {
      this.tutStep = 99;
      this.meta.seenTutorial = true;
      saveMeta(this.meta);
      return;
    }
    if (s[1]()) {
      this.ui.hint(s[2], 4200);
      this.tutStep++;
    }
  }

  /* ======================= achievements ======================= */

  unlockAch(id: string) {
    if (this.meta.achievements.includes(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.meta.achievements.push(id);
    this.meta.shards += a.reward;
    this.runAch.push(a.name);
    saveMeta(this.meta);
    this.ui.toast(a.name, `${a.desc} · +◆${a.reward}`);
    this.audio.sfx('heal');
  }

  private checkAch() {
    const P = this.player;
    if (this.kills >= 100) this.unlockAch('first_blood');
    if (this.kills >= 1000) this.unlockAch('kills1000');
    if (this.T >= 180) this.unlockAch('survivor3');
    if (this.bossesKilled >= 1) this.unlockAch('boss1');
    if (P.evolved.size > 0) this.unlockAch('evolve');
    if (this.maxCombo >= 100) this.unlockAch('combo100');
    if (P.level >= 30) this.unlockAch('level30');
    if (P.weapons.size >= 5) this.unlockAch('full_build');
    if (this.untouchedT >= 120) this.unlockAch('untouchable');
    if (this.won) this.unlockAch('win');
    if (this.endless && this.T >= 900) this.unlockAch('endless15');
  }

  /* ======================= debug / automated playtesting ======================= */

  /** Simple survival bot: flee threats, chase crystals, stay off the walls, dash when cornered. */
  private botSteer() {
    const P = this.player;
    let fx = 0, fz = 0, danger = 0;
    for (const e of this.enemies.list) {
      const dx = P.x - e.x, dz = P.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 140) continue;
      const w = (e.type === 'boss' ? 6 : 1) / Math.max(0.5, d2);
      fx += dx * w; fz += dz * w;
      if (d2 < 6) danger++;
    }
    let incoming = false;
    for (const s of this.proj.shots) {
      const dx = P.x - s.x, dz = P.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 30) {
        // sidestep perpendicular to the bullet's travel direction
        const sp = Math.hypot(s.vx, s.vz) || 1;
        const side = (dx * s.vz - dz * s.vx) > 0 ? 1 : -1;
        fx += (s.vz / sp) * side * 3 / Math.max(0.5, d2);
        fz += (-s.vx / sp) * side * 3 / Math.max(0.5, d2);
        if (d2 < 2.5 && (dx * s.vx + dz * s.vz) > 0) incoming = true;
      }
    }
    for (const q of this.hazards.zones) {
      if (!q.active) continue;
      const dx = P.x - q.x, dz = P.z - q.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < q.r + 2) { fx += dx / d * 0.6; fz += dz / d * 0.6; }
    }
    let best = null as null | { x: number; z: number }, bd = 400;
    for (const gm of this.pickups.gems) {
      const d = (gm.x - P.x) ** 2 + (gm.z - P.z) ** 2;
      if (d < bd) { bd = d; best = gm; }
    }
    for (const p of this.pickups.powers) best = p;
    if (best) { const d = Math.sqrt(bd) || 1; fx += (best.x - P.x) / d * 0.08; fz += (best.z - P.z) / d * 0.08; }
    const r = Math.hypot(P.x, P.z);
    if (r > ARENA_RADIUS * 0.6) { fx -= P.x / r * 0.15 * (r / ARENA_RADIUS); fz -= P.z / r * 0.15 * (r / ARENA_RADIUS); }
    // orbit tangentially to avoid getting pinned
    fx += -P.z / (r + 20) * 0.05; fz += P.x / (r + 20) * 0.05;
    const l = Math.hypot(fx, fz) || 1;
    this.input.moveX = fx / l;
    this.input.moveY = fz / l;
    if (danger >= 2 || incoming) this.input.queueDash();
  }

  /** Run the simulation headlessly for N seconds (bot-controlled). Returns a summary. */
  debugSim(seconds: number, bot = true) {
    if (this.state === 'menu' || this.state === 'over') this.startRun();
    const dt = 1 / 60;
    this.snapCam = true;
    let n = Math.floor(seconds * 60);
    while (n-- > 0) {
      if (this.state === 'levelup') {
        this.ui.hide('#levelup');
        const score = (c: Choice) =>
          c.kind === 'evolve' ? 100 : c.kind === 'weapon' ? (c.level > 1 ? 50 + c.level : this.player.weapons.size < 4 ? 60 : 5)
            : c.kind === 'passive' ? (['power', 'clock', 'area', 'vitality'].includes(c.id) ? 30 : 20) - c.level : 1;
        let bi = 0;
        this.choices.forEach((c, i) => { if (score(c) + Math.random() * 8 > score(this.choices[bi])) bi = i; });
        this.choose(bi);
      }
      if (this.state !== 'play') break;
      if (bot && !this.player.dead) this.botSteer();
      this.update(dt);
    }
    if (this.cineT > 0) {
      this.cineT = 0;
      document.body.classList.remove('cine');
    }
    return {
      state: this.state, T: Math.round(this.T), hp: Math.round(this.player.hp), level: this.player.level, kills: this.kills,
      enemies: this.enemies.list.length, bosses: this.bossesKilled, won: this.won, score: Math.round(this.score),
      weapons: [...this.player.weapons].map(([k, v]) => k + v + (this.player.evolved.has(k) ? '*' : '')).join(' '),
      passives: [...this.player.passives].map(([k, v]) => k + v).join(' '),
      dmg: Object.fromEntries(Object.entries(this.dmgLog).map(([k, v]) => [k, Math.round(v)])),
    };
  }

  /* ======================= end ======================= */

  /** Copy the current frame (must run right after a render, in the same task). */
  captureSnap() {
    try {
      this.r.render(this.time);
      const src = this.r.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = Math.min(1600, src.width);
      c.height = Math.round((c.width / src.width) * src.height);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      this.snap = c;
    } catch {
      this.snap = null;
    }
  }

  private endRun(victory: boolean) {
    if (this.state === 'over') return;
    document.body.classList.remove('cine');
    this.captureSnap();
    this.state = 'over';
    this.input.enabled = false;
    this.input.releaseAll();
    document.body.classList.remove('lowhp');
    this.checkAch();
    const m = this.meta;
    const best = m.stats.bestScore;
    const newBest = this.score > best;
    const total = Math.round(shardsForRun({ kills: this.kills, bosses: this.bossesKilled, time: this.T, victory: this.won, level: this.player.level }) * (this.night ? 1.3 : 1) * (1 + (modMult([...this.mods]) - 1) * 0.5));
    if (this.dailyKey) m.daily[this.dailyKey] = Math.max(m.daily[this.dailyKey] ?? 0, Math.round(this.score));
    const shards = Math.max(0, total - this.paidShards);
    const firstEnd = this.paidShards === 0 && !this.endless;
    this.paidShards = total;
    m.shards += shards;
    if (firstEnd) m.stats.runs++;
    m.stats.kills += this.kills - (this.endless ? this.killsAtEndless : 0);
    m.stats.bosses += this.bossesKilled - (this.endless ? this.bossesAtEndless : 0);
    if (victory && !this.endless) m.stats.wins++;
    m.stats.bestScore = Math.max(m.stats.bestScore, Math.round(this.score));
    m.stats.bestTime = Math.max(m.stats.bestTime, Math.floor(this.T));
    m.stats.shardsEarned += shards;
    const entry = { score: Math.round(this.score), time: Math.floor(this.T), level: this.player.level, kills: this.kills, ship: m.ship, win: this.won, date: new Date().toISOString().slice(0, 10) };
    if (this.endless && this.lastEntry) m.top = m.top.filter((t) => t !== this.lastEntry);
    this.lastEntry = entry;
    m.top.push(entry);
    m.top.sort((a, b) => b.score - a.score);
    m.top = m.top.slice(0, 10);
    saveMeta(m);
    if (this.snap) {
      try {
        this.ui.setOverBackdrop(this.snap.toDataURL('image/jpeg', 0.7));
      } catch {
        /* ignore */
      }
    }
    this.ui.showOver({
      shards, achievements: this.runAch,
      victory, time: this.T, level: this.player.level, kills: this.kills, score: this.score, maxCombo: this.maxCombo,
      bosses: this.bossesKilled, best, newBest, damage: this.damageDealt, weapons: this.player.weapons, evolved: this.player.evolved,
    });
    this.audio.intensity = 0;
    void clamp;
  }
}
