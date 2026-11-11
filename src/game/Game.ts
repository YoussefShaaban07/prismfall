import * as THREE from 'three';
import { Renderer } from '../core/Renderer';
import { Input } from '../core/Input';
import { Audio } from '../core/Audio';
import type { Assets } from '../core/Assets';
import { clamp, damp, rand, store, TAU, pickWeighted, chance } from '../core/util';
import { UI, type Settings } from '../ui/UI';
import { Arena } from './Arena';
import { Particles, Debris } from './Particles';
import { Effects } from './Effects';
import { Player } from './Player';
import { EnemyManager, type Enemy } from './Enemies';
import { BossController } from './Boss';
import { Projectiles } from './Projectiles';
import { WeaponSystem } from './Weapons';
import { Pickups, type PowerKind } from './Pickups';
import { Hazards } from './Hazards';
import { rollChoices, describe, applyChoice, type Choice } from './Upgrades';
import { ARENA_RADIUS, BOSS_TIMES, FINAL_TIME, xpForLevel, type EType } from './data';
import { ACHIEVEMENTS, SHIPS, UPGRADES, loadMeta, saveMeta, shardsForRun, upLv, type MetaState, type ShipId } from './meta';
import { heroMapper } from '../core/Assets';

type State = 'menu' | 'play' | 'levelup' | 'paused' | 'over';

const C = (r: number, g: number, b: number, k = 1) => new THREE.Color(r, g, b).multiplyScalar(k);

export class Game {
  r: Renderer;
  input: Input;
  audio = new Audio();
  ui: UI;
  arena: Arena;
  particles: Particles;
  debris: Debris;
  fx: Effects;
  player: Player;
  enemies: EnemyManager;
  boss: BossController;
  proj: Projectiles;
  weapons: WeaponSystem;
  pickups: Pickups;
  hazards: Hazards;

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
  private fpsAcc = 0;
  private fpsN = 0;
  private autoQDone = false;

  constructor(canvas: HTMLCanvasElement, private assets: Assets, renderer: Renderer) {
    this.r = renderer;
    this.settings = store.get<Settings>('prismfall.settings', { quality: this.defaultQuality(), sfx: 0.8, music: 0.6, shake: true, numbers: true });
    this.ui = new UI(this.settings);
    this.input = new Input(canvas, this.ui.joy, this.ui.knob, this.ui.dashBtn);
    const scene = this.r.scene;
    if (assets.env) {
      scene.environment = assets.env;
      scene.environmentIntensity = 0.4;
    }
    this.arena = new Arena(scene, assets);
    this.particles = new Particles(scene);
    this.debris = new Debris(scene);
    this.fx = new Effects(scene, this.r.camera, this.ui.floaters);
    this.player = new Player(scene, assets);
    this.enemies = new EnemyManager(scene, assets, this);
    this.boss = new BossController(scene, assets, this);
    this.proj = new Projectiles(scene, this);
    this.weapons = new WeaponSystem(scene, this);
    this.pickups = new Pickups(scene, assets, this);
    this.hazards = new Hazards(scene, this);
    this.player.root.visible = false;
    this.player.magnetRing.visible = false;
    this.meta = loadMeta();
    this.previewShip = this.meta.ship;
    this.buildShowroom();

    this.applySettings(this.settings);
    this.bindUI();
    this.ui.showMenu(this.meta.stats.bestScore, this.meta.stats.bestTime, this.input.touchUsed, this.meta.shards);
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
    ui.onPlay = () => this.startRun();
    ui.onRetry = () => this.startRun();
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
    this.input.onPause = () => this.togglePause();
    this.input.onKey = (code) => {
      if (this.state === 'levelup') {
        if (code === 'Digit1' || code === 'Numpad1') ui.pick(0);
        if (code === 'Digit2' || code === 'Numpad2') ui.pick(1);
        if (code === 'Digit3' || code === 'Numpad3') ui.pick(2);
        if (code === 'KeyR') ui.reroll();
      }
      if (this.state === 'menu' && (code === 'Enter' || code === 'Space')) this.startRun();
      if (this.state === 'over' && code === 'Enter') this.startRun();
      if (code === 'KeyM') this.audio.toggleMute();
    };
    this.input.onPadButton = (i) => {
      if (this.state === 'levelup') {
        if (i === 2) ui.pick(0);
        if (i === 3) ui.pick(1);
        if (i === 1) ui.pick(2);
        if (i === 4) ui.reroll();
      } else if ((this.state === 'menu' || this.state === 'over') && i === 0) this.startRun();
    };
  }

  private buildShowroom() {
    const pad = this.assets.object('platform_large', 7, heroMapper(0x5ef2ff, 0.3));
    this.showroom.add(pad);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 1).multiplyScalar(1.2), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
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
    this.r.scene.add(this.showroom);
    this.setShowShip(this.meta.ship);
  }

  private setShowShip(id: ShipId) {
    const def = SHIPS.find((x) => x.id === id)!;
    if (this.showShip) this.showroom.remove(this.showShip);
    this.showShip = this.assets.object(def.model, 4.2, heroMapper(def.accent, 1.2));
    this.showShip.position.y = 2.2;
    this.showroom.add(this.showShip);
  }

  applySettings(s: Settings) {
    this.settings = s;
    store.set('prismfall.settings', s);
    if (this.r.quality !== s.quality) this.r.setQuality(s.quality);
    this.audio.setVolumes(s.sfx, s.music);
    this.r.bloom.strength = s.quality === 'low' ? 0.6 : 0.7;
  }

  /* ======================= flow ======================= */

  startRun() {
    this.audio.init();
    this.audio.startMusic();
    this.audio.resetMusic();
    this.enemies.clear();
    this.boss.clear();
    this.proj.clear();
    this.hazards.clear();
    this.pickups.clear();
    this.particles.clear();
    this.debris.clear();
    this.fx.clear();
    this.weapons.reset();
    const ship = SHIPS.find((x) => x.id === this.meta.ship) ?? SHIPS[0];
    this.player.reset(this.meta, ship);
    this.player.root.visible = true;
    this.showroom.visible = false;
    this.hangarOpen = false;
    this.r.camera.clearViewOffset();
    this.player.magnetRing.visible = true;
    Object.assign(this, {
      dmgLog: {}, T: 0, kills: 0, score: 0, combo: 0, comboT: 0, maxCombo: 0, damageDealt: 0, pendingLevels: 0,
      bossesKilled: 0, nextBoss: BOSS_TIMES[0], bossWarn: 0, won: false, endless: false, rerolls: 3 + upLv(this.meta, 'rerolls'), untouchedT: 0, achT: 0, runAch: [], paidShards: 0, tutStep: this.meta.seenTutorial ? 99 : 0,
      spawnAcc: 0, nextSurge: 50, nextElite: 95, freezeT: 0, slowT: 0, deathT: 0, victoryT: 0, shake: 0, hurtT: 0,
    });
    this.input.releaseAll();
    this.input.enabled = true;
    this.state = 'play';
    this.ui.startRun(this.input.touchUsed);
    this.ui.banner('DEFEND THE COLONY', 'Survive · Level up · Evolve', '#5ef2ff', 2400);
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
    this.player.magnetRing.visible = false;
    this.weapons.reset();
    this.ui.hideHud();
    this.audio.intensity = 0;
    document.body.classList.remove('lowhp');
    this.ui.showMenu(this.meta.stats.bestScore, this.meta.stats.bestTime, this.input.touchUsed, this.meta.shards);
    this.showroom.visible = true;
  }

  togglePause() {
    if (this.state === 'play') this.pause();
    else if (this.state === 'paused') this.resume();
  }
  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.input.releaseAll();
    this.ui.showPause(this.player.weapons, this.player.passives, this.player.evolved);
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

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.input.update();
    this.autoQuality(dt);

    if (this.state === 'play') {
      if (this.freezeT > 0) {
        this.freezeT -= dt;
        dt = 0;
      }
      if (this.slowT > 0) {
        this.slowT -= dt;
        dt *= 0.3;
      }
      this.update(dt);
    } else if (this.state === 'menu') {
      this.updateMenu(dt);
    } else if (this.state === 'over') {
      // let effects settle behind the results screen
      this.particles.update(dt * 0.5);
      this.debris.update(dt * 0.5);
      this.fx.update(dt * 0.5, this.r.width, this.r.height);
    }

    this.updateCamera(dt);
    this.arena.update(dt, this.time, this.player.x, this.player.z, this.boss.e ? 1 : this.bossWarn > 0 ? 0.6 : 0);
    if (this.state !== 'menu') {
      this.enemies.sync(this.time);
      this.boss.sync(this.time, dt);
      this.proj.sync(this.time);
      this.pickups.sync(this.time);
    }
    this.particles.mat.uniforms.uScale.value = this.r.pointScale();
    const g = this.r.grade.uniforms;
    g.uHurt.value = damp(g.uHurt.value as number, this.hurtT > 0 ? 0.55 : 0, 10, dt || 0.016);
    g.uAberr.value = damp(g.uAberr.value as number, this.hurtT > 0 ? 1 : this.player.dashing ? 0.6 : 0, 12, dt || 0.016);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.r.render(this.time);
  };

  /** Measure real frame times during play and step quality down once if the device struggles. */
  private autoQuality(dt: number) {
    if (this.autoQDone || this.state !== 'play' || this.T < 3) return;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsN < 240) return;
    const avg = this.fpsAcc / this.fpsN;
    this.autoQDone = true;
    if (store.get('prismfall.qualityLocked', false)) return;
    const q = this.settings.quality;
    if (avg > 1 / 40 && q !== 'low') {
      this.settings.quality = q === 'ultra' ? 'high' : 'low';
      this.applySettings(this.settings);
      this.ui.toast('GRAPHICS ADJUSTED', `Switched to ${this.settings.quality.toUpperCase()} for smoother play (Pause → Graphics)`);
    } else if (avg < 1 / 75 && q === 'high' && !('ontouchstart' in window)) {
      this.settings.quality = 'ultra';
      this.applySettings(this.settings);
    }
  }

  private updateMenu(dt: number) {
    if (this.showShip) {
      this.showShip.rotation.y = this.time * 0.5;
      this.showShip.position.y = 2.2 + Math.sin(this.time * 1.5) * 0.2;
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
    if (this.state === 'menu' && this.hangarOpen) {
      const a = this.time * 0.25;
      const dist = this.r.width > this.r.height ? 10 : 15;
      this.camPos.set(Math.sin(a) * dist, 4.5 + (dist - 10) * 0.3, Math.cos(a) * dist);
      cam.position.lerp(this.camPos, 1 - Math.exp(-3 * dt));
      this.camLook.set(0, 2.2, 0);
      cam.lookAt(this.camLook);
      const W = this.r.width, H = this.r.height;
      if (W > H) cam.setViewOffset(W, H, W * 0.2, 0, W, H);
      else cam.setViewOffset(W, H, 0, H * 0.27, W, H);
      return;
    }
    cam.clearViewOffset();
    if (this.state === 'menu') {
      if (this.showShip) {
        this.showShip.rotation.y = this.time * 0.5;
        this.showShip.position.y = 2.2 + Math.sin(this.time * 1.5) * 0.2;
      }
      const a = this.time * 0.06;
      this.camPos.set(Math.sin(a) * 46, 15 + Math.sin(this.time * 0.2) * 3, Math.cos(a) * 46);
      cam.position.lerp(this.camPos, 1 - Math.exp(-2 * dt));
      this.camLook.set(0, 4, 0);
      cam.lookAt(this.camLook);
      this.r.sun.target.position.set(0, 0, 0);
      this.r.sun.position.set(-30, 45, 18);
      return;
    }
    const P = this.player;
    // portrait screens need more height to see sideways
    const zoom = aspect < 1 ? Math.pow(1 / aspect, 0.55) : 1;
    const bossZoom = this.boss.e ? 1.15 : 1;
    const h = 24 * zoom * bossZoom;
    const lead = 1.2;
    const tx = P.x + P.vx * 0.12 * lead;
    const tz = P.z + P.vz * 0.12 * lead;
    this.camPos.set(tx, h, tz + h * 0.62);
    cam.position.lerp(this.camPos, 1 - Math.exp(-6 * dt));
    let sx = 0, sy = 0;
    if (this.shake > 0 && this.settings.shake) {
      const s = this.shake * this.shake * 1.4;
      sx = rand(-s, s);
      sy = rand(-s, s);
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.camLook.set(cam.position.x + sx, 0, cam.position.z - h * 0.62 + sy);
    cam.lookAt(this.camLook);
    // keep the shadow frustum centred on the action
    this.r.sun.position.set(P.x - 30, 45, P.z + 18);
    this.r.sun.target.position.set(P.x, 0, P.z);
  }

  /* ======================= simulation ======================= */

  private update(dt: number) {
    const P = this.player;
    this.T += P.dead ? 0 : dt;

    if (!P.dead) {
      if (P.update(dt, this.input, this.time)) this.onDash();
      if (P.dashing) this.particles.emit(P.x, 0.8, P.z, rand(-1, 1), 0.5, rand(-1, 1), 0.35, 0.9, this.colors.cyan, 3);
      // engine trail
      const sp = Math.hypot(P.vx, P.vz);
      if (sp > 1 && chance(0.8)) {
        const bx = P.x - Math.sin(P.ang) * 1.2, bz = P.z - Math.cos(P.ang) * 1.2;
        this.particles.emit(bx, 0.9, bz, -P.vx * 0.1 + rand(-0.4, 0.4), rand(0, 0.4), -P.vz * 0.1 + rand(-0.4, 0.4), 0.45, 0.45, this.colors.cyan, 3);
      }
      this.director(dt);
      this.weapons.update(dt);
    } else {
      this.deathT -= dt;
      if (this.deathT <= 0) this.endRun(false);
    }

    this.enemies.update(dt);
    this.proj.update(dt);
    this.hazards.update(dt, this.time);
    this.pickups.update(dt);
    this.particles.update(dt);
    this.debris.update(dt);
    this.fx.update(dt, this.r.width, this.r.height);

    // combo decay
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    this.tutorial();

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

    // victory sequence
    if (this.victoryT > 0) {
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
    this.mmT -= dt;
    if (this.mmT <= 0) {
      this.mmT = 0.1;
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
        if (this.endless || this.won) this.nextBoss = T + 100;
        else {
          const idx = BOSS_TIMES.indexOf(this.nextBoss);
          this.nextBoss = idx >= 0 && idx < BOSS_TIMES.length - 1 ? BOSS_TIMES[idx + 1] : this.nextBoss < FINAL_TIME ? FINAL_TIME : Infinity;
        }
      }
    }

    // regular spawns
    const rate = Math.min(22, 0.9 + T / 42 + Math.pow(T / 120, 2)) * (this.boss.e ? 0.3 : 1) * (this.endless ? 1.3 : 1);
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
      if (!this.boss.e) {
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
    if (T >= this.nextElite) {
      this.nextElite += 70;
      const pool: EType[] = T > 240 ? ['brute', 'wraith', 'spitter'] : ['brute', 'spitter', 'meteor'];
      const p = this.spawnPoint(20, 26);
      const e = this.enemies.spawn(pool[Math.floor(Math.random() * pool.length)], p.x, p.z, true);
      if (e) this.ui.banner('ELITE DETECTED', `Golden ${e.def.name} · drops supplies`, '#ffd84f', 1800);
    }
  }

  private pickType(): EType {
    const T = this.T;
    const w: [EType, number][] = [['drone', 10]];
    if (T > 35) w.push(['dart', 2 + T / 60]);
    if (T > 65) w.push(['meteor', 2 + T / 90]);
    if (T > 95) w.push(['spitter', 1.5 + T / 110]);
    if (T > 130) w.push(['brute', 0.8 + T / 160]);
    if (T > 200) w.push(['wraith', 1 + T / 120]);
    if (T > 170) w.push(['bomber', 1.2 + T / 160]);
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

  damage(e: Enemy, amt: number, kx: number, kz: number) {
    if (e.dead) return;
    const crit = chance(0.08);
    if (crit) amt *= 2;
    e.hp -= amt;
    this.damageDealt += amt;
    e.flash = 0.08;
    const heavy = e.type === 'boss' ? 0.05 : e.type === 'turret' ? 0 : e.type === 'brute' || e.elite ? 0.3 : 1;
    e.kx += kx * heavy;
    e.kz += kz * heavy;
    if (this.settings.numbers && (crit || amt >= 25 || chance(0.35))) {
      this.fx.text(e.x, 2.2, e.z, String(Math.round(amt)), crit ? 'crit' : '');
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
    this.kills++;
    this.combo++;
    this.comboT = 2.6;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.score += Math.round(e.def.score * (1 + Math.floor(this.combo / 10) * 0.2) * (e.elite ? 10 : 1));
    const col = new THREE.Color(e.def.color).multiplyScalar(3);
    const big = e.type === 'brute' || e.elite;
    this.particles.burst(e.x, e.def.hover + 0.3, e.z, col, big ? 40 : 14, big ? 12 : 8, 0.6, big ? 1 : 0.6, 0.6);
    this.particles.burst(e.x, e.def.hover + 0.3, e.z, this.colors.white, big ? 10 : 4, 5, 0.25, 0.8, 0.3);
    this.debris.spawn(e.x, e.def.hover, e.z, this.colors.debris, big ? 10 : 3, big ? 9 : 6, big ? 1.4 : 0.8);
    if (e.elite) this.freezeT = Math.max(this.freezeT, 0.06);
    if (big) {
      this.fx.ring(e.x, e.z, 4, e.def.color, 0.4, 3);
      this.fx.scorch(e.x, e.z, 2.5);
      this.shake = Math.max(this.shake, 0.4);
      this.audio.sfx('boom');
    } else this.audio.sfx('kill');

    // loot
    this.pickups.dropGem(e.x, e.z, e.def.xp * (e.elite ? 12 : 1));
    if (e.elite) {
      const kinds: PowerKind[] = ['heal', 'magnet', 'bomb'];
      this.pickups.dropPower(kinds[Math.floor(Math.random() * 3)], e.x + 1, e.z);
    } else {
      const r = Math.random();
      if (r < 0.006) this.pickups.dropPower('heal', e.x, e.z);
      else if (r < 0.0095) this.pickups.dropPower('magnet', e.x, e.z);
      else if (r < 0.012) this.pickups.dropPower('bomb', e.x, e.z);
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
    this.bossesKilled++;
    this.kills++;
    this.score += final ? 25000 : 4000 * this.bossesKilled;
    const col = this.boss.color.clone().multiplyScalar(3);
    this.freezeT = 0.1;
    this.slowT = 1.4;
    this.shake = 1.6;
    this.ui.flash();
    this.audio.sfx('bossdie');
    for (let i = 0; i < 5; i++) {
      const ox = rand(-3, 3), oz = rand(-3, 3);
      this.particles.burst(e.x + ox, 2, e.z + oz, col, 60, 22, 1.2, 1.4, 0.9);
      this.fx.ring(e.x + ox, e.z + oz, 12 + i * 4, this.boss.color, 0.9 + i * 0.15, 4);
    }
    this.particles.burst(e.x, 2, e.z, this.colors.white, 60, 16, 0.8, 1.2, 0.8);
    this.debris.spawn(e.x, 2, e.z, this.colors.debris, 40, 14, 2);
    this.fx.scorch(e.x, e.z, 7);
    this.proj.clearEnemyShots();
    this.hazards.clear();
    this.boss.clear();
    // treasure: a fountain of crystals worth ~2 levels
    const total = this.player.xpNext * 2.2 + xpForLevel(this.player.level + 1);
    for (let i = 0; i < 18; i++) this.pickups.dropGem(e.x + rand(-2, 2), e.z + rand(-2, 2), Math.ceil(total / 18));
    this.pickups.dropPower('heal', e.x + 2, e.z);
    this.pickups.dropPower('magnet', e.x - 2, e.z);
    if (final && !this.won) {
      this.won = true;
      this.victoryT = 3;
      this.ui.banner('CORE DESTROYED', 'The colony is saved', '#7ff6ff', 3200);
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
    this.fx.ring(e.x, e.z, r, 0xff3a2a, 0.35, 3);
    this.fx.scorch(e.x, e.z, 2.2);
    this.audio.sfx('boom');
    this.shake = Math.max(this.shake, 0.45);
    if (!P.dead && Math.hypot(P.x - e.x, P.z - e.z) < r + P.r) this.hurtPlayer(e.dmg, null);
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
    this.deathT = 2.2;
    this.slowT = 1.6;
    this.shake = 1.4;
    this.ui.flash('rgba(255,80,80,0.6)');
    this.audio.sfx('bossdie');
    this.particles.burst(P.x, 1, P.z, this.colors.cyan, 90, 18, 1.2, 1.2, 0.8);
    this.particles.burst(P.x, 1, P.z, this.colors.orange, 60, 12, 1, 1, 0.8);
    this.debris.spawn(P.x, 1, P.z, new THREE.Color(0.9, 0.9, 0.95), 24, 12, 1.4);
    this.fx.ring(P.x, P.z, 14, 0x5ef2ff, 1, 4);
    this.fx.scorch(P.x, P.z, 4);
  }

  private onDash() {
    const P = this.player;
    this.audio.sfx('dash');
    this.fx.ring(P.x, P.z, 3, 0x5ef2ff, 0.3, 3);
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
    this.particles.ring(this.player.x, 0.6, this.player.z, this.colors.yellow, 40, 10, 0.5, 0.6);
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
      this.fx.ring(this.player.x, this.player.z, 10, 0xffd84f, 0.8, 4);
    }
    this.pendingLevels--;
    this.player.inv = Math.max(this.player.inv, 0.8);
    this.state = 'play';
    this.last = performance.now();
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
    for (const s of this.proj.shots) {
      const dx = P.x - s.x, dz = P.z - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 30) { fx += dx / Math.max(0.5, d2) * 2; fz += dz / Math.max(0.5, d2) * 2; }
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
    if (danger >= 2) this.input.queueDash();
  }

  /** Run the simulation headlessly for N seconds (bot-controlled). Returns a summary. */
  debugSim(seconds: number, bot = true) {
    if (this.state === 'menu' || this.state === 'over') this.startRun();
    const dt = 1 / 60;
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
    return {
      state: this.state, T: Math.round(this.T), hp: Math.round(this.player.hp), level: this.player.level, kills: this.kills,
      enemies: this.enemies.list.length, bosses: this.bossesKilled, won: this.won, score: Math.round(this.score),
      weapons: [...this.player.weapons].map(([k, v]) => k + v + (this.player.evolved.has(k) ? '*' : '')).join(' '),
      passives: [...this.player.passives].map(([k, v]) => k + v).join(' '),
      dmg: Object.fromEntries(Object.entries(this.dmgLog).map(([k, v]) => [k, Math.round(v)])),
    };
  }

  /* ======================= end ======================= */

  private endRun(victory: boolean) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.input.enabled = false;
    this.input.releaseAll();
    document.body.classList.remove('lowhp');
    this.checkAch();
    const m = this.meta;
    const best = m.stats.bestScore;
    const newBest = this.score > best;
    const total = shardsForRun({ kills: this.kills, bosses: this.bossesKilled, time: this.T, victory: this.won, level: this.player.level });
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
    saveMeta(m);
    this.ui.showOver({
      shards, achievements: this.runAch,
      victory, time: this.T, level: this.player.level, kills: this.kills, score: this.score, maxCombo: this.maxCombo,
      bosses: this.bossesKilled, best, newBest, damage: this.damageDealt, weapons: this.player.weapons, evolved: this.player.evolved,
    });
    this.audio.intensity = 0;
    void clamp;
  }
}
