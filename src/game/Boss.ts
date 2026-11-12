import * as THREE from 'three';
import type { Assets, ModelName } from '../core/Assets';
import { alienMapper } from '../core/Assets';
import { rand, TAU, angleDiff, pickWeighted } from '../core/util';
import { BOSS_NAMES, EDEFS, hpScale } from './data';
import type { Enemy } from './Enemies';
import type { Game } from './Game';
import { SHIP_YAW } from './Player';
import { Trail } from './Trails';

interface BossLook {
  model: ModelName;
  color: number;
  size: number;
}
export const LOOKS: BossLook[] = [
  { model: 'craft_cargoA', color: 0xc86bff, size: 9 },
  { model: 'craft_miner', color: 0x2fffa8, size: 9.5 },
  { model: 'craft_speederD', color: 0xff3b5c, size: 10 },
];

export class BossController {
  e: Enemy | null = null;
  name = '';
  final = false;
  group = new THREE.Group();
  body: THREE.Group | null = null;
  rings: THREE.Mesh[] = [];
  mats: THREE.MeshStandardMaterial[] = [];
  /** escalation stage reached this fight (0, 1 at 2/3 hull, 2 at 1/3) */
  stage = 0;
  /** shared clocks for the Core's crystal veins */
  private coreTime = { value: 0 };
  private coreRage = { value: 0 };
  light: THREE.PointLight;
  color = new THREE.Color();
  index = 0;
  private spin = 0;
  private lastPhase = 0;
  private trails: Trail[] = [];
  private tv = new THREE.Vector3();
  private smokeT = 0;
  private tendrilT = 0;
  private charge: THREE.Mesh | null = null;
  private landed = false;
  private sigCount = 0;

  constructor(scene: THREE.Scene, private assets: Assets, private g: Game) {
    scene.add(this.group);
    this.group.visible = false;
    this.light = new THREE.PointLight(0xc86bff, 10, 24, 1.5);
    this.light.position.y = 4;
    this.group.add(this.light);
    for (let i = 0; i < 2; i++) {
      const t = new Trail(scene, 0xc86bff, 1.4, 30, 0.025);
      t.visible = false;
      this.trails.push(t);
    }
  }

  private build(final: boolean, idx: number) {
    if (this.body) {
      this.group.remove(this.body);
    }
    for (const r of this.rings) this.group.remove(r);
    this.rings = [];
    this.mats = [];
    const body = new THREE.Group();
    let look: BossLook;
    if (final) {
      look = { model: 'rock_crystalsLargeA', color: 0x7ff6ff, size: 11 };
    } else {
      look = LOOKS[idx % LOOKS.length];
    }
    this.color.set(look.color);
    const mapper = alienMapper(look.color, final ? 1.6 : 0.6, 0.7);
    const ship = this.assets.object(look.model, look.size, (n, s) => {
      if (final && n === 'crystal') {
        // the Core's crystals: glassy, iridescent, lit from within
        const pm = new THREE.MeshPhysicalMaterial({
          color: 0x9ffcff, emissive: 0x2ad8ff, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0,
          transmission: this.g.r.quality === 'low' ? 0 : 0.85, thickness: 2.5, ior: 1.6,
          iridescence: 1, iridescenceIOR: 1.4, clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true,
        });
        return pm;
      }
      const m = mapper(n, s) as THREE.MeshStandardMaterial;
      this.mats.push(m);
      return m;
    });
    if (!final) ship.rotation.y = SHIP_YAW;
    if (final) {
      // replace the rock with a custom prism cluster on an obsidian base
      ship.visible = false;
      // real transmission costs a second scene render every frame, so only ULTRA gets it; the energy
      // veins below carry the "lit from within" look on every tier
      const ultra = this.g.r.quality === 'ultra';
      const glass = (col: number, em: number, k: number) => {
        const m = new THREE.MeshPhysicalMaterial({
          color: ultra ? col : new THREE.Color(col).multiplyScalar(0.55), emissive: em, emissiveIntensity: ultra ? k : k * 0.8, roughness: 0.06, metalness: 0,
          transmission: ultra ? 0.75 : 0, thickness: 3, ior: 1.6,
          iridescence: 1, iridescenceIOR: 1.35, clearcoat: 1, clearcoatRoughness: 0.04, flatShading: true,
        });
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = this.coreTime;
          sh.uniforms.uRage = this.coreRage;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vCoreP;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoreP = position;');
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uRage; varying vec3 vCoreP;')
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
              {
                // energy veins: thin wandering filaments that flow up each prism, pulsing faster as the Core weakens
                float speed = 1.6 + uRage * 3.0;
                float w = vCoreP.y * 1.4 - uTime * speed + sin(vCoreP.x * 2.3 + vCoreP.z * 1.7) * 1.2;
                float v1 = pow(1.0 - abs(sin(w)), 26.0);
                float v2 = pow(1.0 - abs(sin(vCoreP.x * 3.1 - vCoreP.z * 2.6 + vCoreP.y * 0.4 + uTime * 0.7)), 40.0);
                float beat = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(uTime * (2.4 + uRage * 4.0)), 3.0);
                totalEmissiveRadiance += emissive * (v1 * 4.0 + v2 * 2.0) * beat;
              }`,
            );
        };
        m.customProgramCacheKey = () => 'core-glass-' + (ultra ? 'u' : 'h');
        return m;
      };
      const prism = (h: number, w: number) => {
        const gm = new THREE.CylinderGeometry(0, w, h * 0.25, 6, 1).translate(0, h * 0.875, 0);
        const body2 = new THREE.CylinderGeometry(w, w * 0.8, h * 0.75, 6, 1).translate(0, h * 0.375, 0);
        return [gm, body2];
      };
      const cl = new THREE.Group();
      const parts: [number, number, number, number, number][] = [
        // height, width, tiltX, tiltZ, yaw
        [9, 1.6, 0, 0, 0], [6, 1.1, 0.42, 0, 0.3], [6.5, 1.1, -0.38, 0.1, 1.2], [5.5, 1, 0.1, 0.45, 2.1],
        [5, 0.9, -0.1, -0.48, 3.0], [4.2, 0.8, 0.55, 0.3, 4.0], [4.5, 0.8, -0.5, -0.35, 5.1],
      ];
      const mA = glass(0x9ffcff, 0x2ad8ff, 0.7), mB = glass(0xd6b8ff, 0x8a5bff, 0.8);
      parts.forEach(([h, w, tx, tz, yw], i) => {
        const pg = new THREE.Group();
        for (const geo of prism(h, w)) {
          const m = new THREE.Mesh(geo, i % 2 ? mB : mA);
          m.castShadow = true;
          pg.add(m);
        }
        pg.rotation.set(tx, yw, tz);
        cl.add(pg);
      });
      cl.position.y = 0.6;
      body.add(cl);
      body.userData.cluster = cl;
      const base = this.assets.object('rock_largeA', 8, () => new THREE.MeshStandardMaterial({ color: 0x15111c, roughness: 0.35, metalness: 0.6, flatShading: true }));
      base.scale.y = 0.4;
      base.position.y = -0.4;
      body.add(base);
    }
    body.add(ship);
    if (!final) {
      // twin turrets bolted on top, tracking the player
      const turrets: THREE.Object3D[] = [];
      for (const sx of [-1.2, 1.2]) {
        const t = this.assets.object('turret_double', 2.2, (n, s) => {
          const m = mapper(n, s) as THREE.MeshStandardMaterial;
          this.mats.push(m);
          return m;
        });
        t.position.set(sx * (look.size / 6), (ship.userData.height as number) * 0.85, 0);
        body.add(t);
        turrets.push(t);
      }
      body.userData.turrets = turrets;
    } else {
      // crystal core glow
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.2, 0),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1, 1).multiplyScalar(1.8) }),
      );
      core.position.y = 10.5;
      body.add(core);
      body.userData.core = core;
      const shards: THREE.Mesh[] = [];
      const shardMat = new THREE.MeshPhysicalMaterial({ color: 0xb48bff, emissive: 0x7a4dff, emissiveIntensity: 1.2, roughness: 0.1, transmission: 0.6, thickness: 1, iridescence: 1, flatShading: true });
      for (let i = 0; i < 9; i++) {
        const sh = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), shardMat);
        sh.scale.set(0.6, 1.6, 0.6);
        sh.castShadow = true;
        body.add(sh);
        shards.push(sh);
      }
      body.userData.shards = shards;
    }
    // energy rings
    const ringMat = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(1.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
    const n = final ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(5.6 + i * 1.5, 0.08, 8, 96), ringMat);
      r.position.y = 2.5;
      this.group.add(r);
      this.rings.push(r);
    }
    this.light.color.copy(this.color);
    if (!this.charge) {
      this.charge = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 3),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      this.charge.renderOrder = 6;
      this.group.add(this.charge);
    }
    this.group.add(body);
    this.body = body;
  }

  spawn(final: boolean) {
    const g = this.g;
    const idx = g.bossesKilled;
    this.final = final;
    this.index = idx;
    this.build(final, idx);
    const a = rand(0, TAU);
    const p = g.spawnPoint(18, 22, a);
    const e = g.enemies.spawn('boss', p.x, p.z)!;
    const hp = (final ? 2600 : 850 + 550 * idx) * hpScale(g.T) * (g.endless ? 1.5 : 1);
    e.hp = e.maxHp = hp;
    this.stage = 0;
    e.r = final ? 4.2 : 3.4;
    e.spd = final ? 2.6 : 2.3 + idx * 0.2;
    e.dmg = EDEFS.boss.damage * (1 + g.T / 600);
    e.phase = 0;
    e.timer = 2.5;
    e.spawnT = 2.2;
    this.e = e;
    this.landed = false;
    this.name = final ? 'THE PRISM CORE' : BOSS_NAMES[idx % BOSS_NAMES.length];
    this.group.visible = true;
    this.group.position.set(e.x, 0, e.z);
    g.fx.ring(e.x, e.z, 14, this.color, 1.0, 2);
    g.particles.ring(e.x, 0.5, e.z, this.color, 80, 18, 0.8, 0.9);
    g.shake = Math.max(g.shake, 1.2);
  }

  clear() {
    this.e = null;
    this.group.visible = false;
    for (const t of this.trails) t.visible = false;
  }

  /** Called from EnemyManager.update for the boss entity. Writes e.vx/e.vz directly. */
  update(e: Enemy, dt: number, ux: number, uz: number, d: number) {
    const g = this.g;
    // escalation: at two thirds and one third hull the mothership pushes harder
    const stage = e.hp < e.maxHp / 3 ? 2 : e.hp < (e.maxHp * 2) / 3 ? 1 : 0;
    if (stage > this.stage) {
      this.stage = stage;
      g.bossEscalate(e, stage);
    }
    const fast = (this.final ? 1.35 : 1 + this.index * 0.1) * (1 + this.stage * 0.12);
    e.timer -= dt;
    e.sub -= dt;
    const aim = Math.atan2(ux, uz);
    const k = 1 - Math.exp(-3 * dt);
    const moveTo = (tx: number, tz: number) => {
      e.vx += (tx - e.vx) * k;
      e.vz += (tz - e.vz) * k;
    };
    const shoot = (a: number, spd: number, size = 1) =>
      g.proj.enemyShot(e.x + Math.sin(a) * 2.5, e.z + Math.cos(a) * 2.5, Math.sin(a) * spd, Math.cos(a) * spd, e.dmg * 0.36, this.color.getHex(), size);

    if (e.spawnT > 0) {
      moveTo(0, 0);
      return;
    }

    switch (e.phase) {
      case 0: // stalk the player
        moveTo(ux * e.spd, uz * e.spd);
        if (e.timer <= 0) this.nextPhase(e);
        break;
      case 1: // radial bursts
        moveTo(0, 0);
        if (e.sub <= 0) {
          e.sub = 0.65 / fast;
          const n = this.final ? 30 : 14 + this.index * 5;
          const off = rand(0, TAU);
          for (let i = 0; i < n; i++) shoot(off + (i / n) * TAU, (this.index === 0 && !this.final ? 7.5 : 9) * fast);
          g.audio.sfx('zap');
          g.fx.ring(e.x, e.z, 5, this.color, 0.35, 3);
        }
        if (e.timer <= 0) this.toChase(e);
        break;
      case 2: // spiral stream
        moveTo(ux * e.spd * 0.25, uz * e.spd * 0.25);
        if (e.sub <= 0) {
          e.sub = 0.075 / fast;
          this.spin += 0.32;
          const arms = this.final ? 4 : 2 + (this.index % 2);
          for (let i = 0; i < arms; i++) shoot(this.spin + (i / arms) * TAU, 10 * fast, 0.9);
        }
        if (e.timer <= 0) this.toChase(e);
        break;
      case 3: // summon escorts
        moveTo(0, 0);
        if (e.sub <= 0 && e.st < 1) {
          e.st = 1;
          const n = this.final ? 10 : 6 + this.index * 2;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            const type = this.final ? (i % 2 ? 'wraith' : 'dart') : i % 3 === 0 ? 'dart' : 'drone';
            const s = g.enemies.spawn(type, e.x + Math.sin(a) * 5, e.z + Math.cos(a) * 5);
            if (s) g.fx.ring(s.x, s.z, 2, this.color, 0.4, 3);
          }
          g.audio.sfx('spawn');
        }
        if (e.timer <= 0) this.toChase(e);
        break;
      case 4: // charge: telegraph then dash
        if (e.st === 0) {
          moveTo(0, 0);
          e.aimx = ux;
          e.aimz = uz;
          if (e.sub <= 0) {
            e.st = 1;
            e.sub = 0.9 / fast;
            g.fx.telegraph(e.x, e.z, aim, 34, e.r * 2, 0.9 / fast);
          }
        } else if (e.st === 1) {
          moveTo(0, 0);
          if (e.sub <= 0) {
            e.st = 2;
            e.sub = 0.75;
            g.audio.sfx('dash');
          }
        } else {
          e.vx = e.aimx * e.spd * 9;
          e.vz = e.aimz * e.spd * 9;
          g.particles.emit(e.x, 1.5, e.z, rand(-2, 2), 1, rand(-2, 2), 0.5, 1.4, this.color, 2);
          if (e.sub <= 0) this.toChase(e);
        }
        break;
      case 6: // signature attack, unique per boss
        moveTo(ux * e.spd * 0.3, uz * e.spd * 0.3);
        this.signature(e, ux, uz, aim);
        if (e.timer <= 0) this.toChase(e);
        break;
      case 5: // final only: rotating cross of bullet walls + aimed volleys
        moveTo(0, 0);
        if (e.sub <= 0) {
          e.sub = 0.11;
          this.spin += 0.11;
          for (let i = 0; i < 6; i++) shoot(this.spin + (i / 6) * TAU, 8.5, 1.1);
          if (Math.random() < 0.18) for (let j = -2; j <= 2; j++) shoot(aim + j * 0.12, 15, 0.8);
        }
        if (e.timer <= 0) this.toChase(e);
        break;
    }
    void d;
  }

  /** Each mothership has its own signature move; the Core cycles through all of them. */
  private signature(e: Enemy, ux: number, uz: number, aim: number) {
    const g = this.g;
    const P = g.player;
    const kind = this.final ? this.sigCount % 3 : this.index % 3;
    const H = g.hazards;
    const dmgK = 1 + g.T / 900;
    if (kind === 0) {
      // carpet bombing: blast zones walk along the player's path
      if (e.sub <= 0 && e.st < (this.final ? 14 : 10)) {
        e.sub = 0.2;
        e.st++;
        const lead = 0.45 + e.st * 0.04;
        const x = P.x + P.vx * lead + rand(-3, 3);
        const z = P.z + P.vz * lead + rand(-3, 3);
        H.blast(x, z, 2.6, 1.0, 20 * dmgK, this.color.getHex(), true);
      }
    } else if (kind === 1) {
      // acid rain: lingering pools around the player
      if (e.sub <= 0 && e.st < (this.final ? 8 : 6)) {
        e.sub = 0.3;
        e.st++;
        const a = rand(0, TAU), d = e.st === 1 ? 0 : rand(3, 9);
        H.pool(P.x + Math.cos(a) * d, P.z + Math.sin(a) * d, 3.2, 0.9, 4.5, 8 * dmgK, 0x5dff3a);
      }
    } else {
      // laser sweep: rotating beams from the hull
      if (e.st === 0) {
        e.st = 1;
        const n = this.final ? 4 : 3;
        const dir = Math.random() < 0.5 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          H.sweep(() => (this.e && !this.e.dead ? { x: this.e.x, z: this.e.z } : null), aim + (i / n) * TAU + 0.6, 0.85 * dir, 30, 1.1, 1.0, 3.6, 18 * dmgK, this.color.getHex());
        }
        g.audio.sfx('lance');
      }
    }
    void ux; void uz;
  }

  private toChase(e: Enemy) {
    e.phase = 0;
    e.timer = this.final ? rand(1.2, 2) : rand(1.8, 3);
    e.st = 0;
  }

  private nextPhase(e: Enemy) {
    const opts: [number, number][] = [[1, 2.5], [2, 2.5], [3, 1.3], [4, 2.2], [6, 3]];
    if (this.final) opts.push([5, 3]);
    let p = pickWeighted(opts);
    if (p === this.lastPhase) p = pickWeighted(opts);
    this.lastPhase = p;
    if (p === 6) {
      this.sigCount++;
      const names = ['CARPET BOMBING', 'ACID RAIN', 'LASER SWEEP'];
      const kind = this.final ? this.sigCount % 3 : this.index % 3;
      this.g.fx.text(e.x, 5, e.z, names[kind], 'big boss');
    }
    e.phase = p;
    e.st = 0;
    e.sub = 0.2;
    e.timer = p === 1 ? 2.2 : p === 2 ? 2.8 : p === 3 ? 1.2 : p === 4 ? 2.6 : p === 6 ? 4.2 : 3.5;
    if (p === 4) e.sub = 0.1;
  }

  sync(time: number, dt: number) {
    const e = this.e;
    if (!e || !this.body) return;
    this.group.position.set(e.x, 0, e.z);
    this.coreTime.value = time % 1000;
    this.coreRage.value = Math.min(1, Math.max(0, 1 - e.hp / e.maxHp));
    const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 2.2 : 1;
    const fall = 1 - spawnK;
    const y = 1.2 + Math.sin(time * 1.4) * 0.3 + fall * fall * 70;
    if (e.spawnT > 0) {
      // atmospheric entry: heat glow and a smoke column trailing above
      this.g.particles.fireball(e.x + rand(-1.5, 1.5), y + 1, e.z + rand(-1.5, 1.5), 1.2, 2);
      // the smoke column stays up high so the landing zone isn't left fogged in for the fight
      if (y > 8) this.g.smoke.trail(e.x + rand(-2, 2), y + 3, e.z + rand(-2, 2), 2.5, 1.8);
      if (!this.landed && e.spawnT < 0.12) {
        this.landed = true;
        this.g.fx.shock(e.x, e.z, 30, 1.8, 0.9);
        this.g.fx.ring(e.x, e.z, 20, this.color, 0.8, 1.6);
        this.g.smoke.puff(e.x, 0.5, e.z, 22, 3.6, 1.7);
        this.g.lighting.flash(e.x, e.z, this.color, 80, 40, 0.9);
        this.g.shake = Math.max(this.g.shake, 1.2);
        this.g.audio.sfx('bomb');
      }
    }
    this.body.position.y = y;
    const sp = Math.hypot(e.vx, e.vz);
    if (!this.final) {
      const target = sp > 0.5 ? Math.atan2(e.vx, e.vz) : Math.atan2(this.g.player.x - e.x, this.g.player.z - e.z);
      e.yaw += angleDiff(e.yaw, target) * Math.min(1, dt * 3);
      this.body.rotation.y = e.yaw;
      this.body.rotation.z = Math.sin(time) * 0.06;
      const P = this.g.player;
      const aim = Math.atan2(P.x - e.x, P.z - e.z) - e.yaw;
      for (const t of (this.body.userData.turrets as THREE.Object3D[] | undefined) ?? []) {
        const cur = t.rotation.y;
        let d = (aim + Math.PI - cur) % (Math.PI * 2);
        if (d < 0) d += Math.PI * 2;
        t.rotation.y = cur + (d - Math.PI) * Math.min(1, dt * 4);
      }
    } else {
      this.body.rotation.y += dt * 0.6;
      const core = this.body.userData.core as THREE.Mesh | undefined;
      if (core) {
        core.rotation.x += dt * 1.3;
        core.rotation.y += dt * 2;
        const pulse = 1 + Math.sin(time * 6) * 0.08;
        core.scale.setScalar(pulse);
      }
      const shards = this.body.userData.shards as THREE.Mesh[] | undefined;
      shards?.forEach((sh, i) => {
        const a = time * (0.9 + (i % 3) * 0.25) + (i / shards.length) * Math.PI * 2;
        const r = 6.5 + (i % 3) * 1.4;
        sh.position.set(Math.cos(a) * r, 5 + Math.sin(time * 2 + i) * 1.5, Math.sin(a) * r);
        sh.rotation.set(time * 2 + i, time * 1.3, 0);
      });
      // energy tendrils lashing from the core to the ground
      this.tendrilT -= dt;
      if (this.tendrilT <= 0 && e.spawnT <= 0) {
        this.tendrilT = 0.25 + Math.random() * 0.3;
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 7;
        const top = new THREE.Vector3(e.x, y + 10, e.z);
        const mid = new THREE.Vector3(e.x + Math.cos(a) * r * 0.5, y + 4, e.z + Math.sin(a) * r * 0.5);
        const end = new THREE.Vector3(e.x + Math.cos(a) * r, 0.2, e.z + Math.sin(a) * r);
        this.g.fx.lightning([top, mid, end], 0x9ffcff, 0.18);
        this.g.particles.burst(end.x, 0.3, end.z, this.g.colors.cyan, 6, 5, 0.3, 0.4);
      }
    }
    this.rings.forEach((r, i) => {
      r.rotation.x = Math.PI / 2 + Math.sin(time * (0.7 + i * 0.3)) * 0.5;
      r.rotation.y = time * (0.9 + i * 0.4) * (i % 2 ? -1 : 1);
      r.position.y = y + 1.5;
      const charge = e.phase === 4 && e.st === 1 ? 1.4 : 1;
      r.scale.setScalar(charge * (1 + Math.sin(time * 3 + i) * 0.04));
    });
    const flash = e.flash > 0 ? Math.min(1, e.flash * 14) : 0;
    for (const m of this.mats) {
      const u = m.userData.rim as { uFlash: { value: number }; uDamage: { value: number } } | undefined;
      if (u) {
        u.uFlash.value = flash * 0.15;
        u.uDamage.value = Math.min(1, Math.max(0, 1 - e.hp / e.maxHp)) * 0.9;
      }
    }
    this.light.intensity = 10 + flash * 20;
    this.light.position.y = y + 3;

    // charge-up glow: the bow lights up before dashes and radial volleys
    if (this.charge) {
      let k = 0;
      if (e.phase === 4 && e.st === 1) k = 1 - Math.max(0, e.sub) / 0.9;
      else if (e.phase === 4 && e.st === 0) k = 0.2;
      else if (e.phase === 1) k = 1 - Math.min(1, Math.max(0, e.sub) / 0.65);
      else if (e.phase === 2) k = 0.5 + Math.sin(time * 30) * 0.2;
      const cm = this.charge.material as THREE.MeshBasicMaterial;
      cm.color.copy(this.color).multiplyScalar(0.6 + k * 1.4);
      cm.opacity = k * 0.8;
      this.charge.visible = k > 0.02;
      const fx = this.final ? 0 : Math.sin(e.yaw) * 3.6, fz = this.final ? 0 : Math.cos(e.yaw) * 3.6;
      this.charge.position.set(fx, y + (this.final ? 10.5 : 2.2), fz);
      this.charge.scale.setScalar(0.4 + k * (this.final ? 3 : 1.6) + Math.sin(time * 40) * 0.05 * k);
      if (k > 0.5 && Math.random() < k * 0.6) {
        const a = Math.random() * Math.PI * 2, r = 4;
        const px = e.x + fx + Math.cos(a) * r, pz = e.z + fz + Math.sin(a) * r;
        this.g.particles.emit(px, y + 2, pz, -Math.cos(a) * r * 3, 0, -Math.sin(a) * r * 3, 0.3, 0.4, this.color.clone().multiplyScalar(2), 0);
      }
    }

    // twin engine ribbons from the stern
    const back = this.final ? 0 : 1;
    const yaw = e.yaw;
    for (let i = 0; i < this.trails.length; i++) {
      const t = this.trails[i];
      if (this.final) { t.visible = false; continue; }
      t.setColor(this.color);
      t.visible = true;
      const side = i === 0 ? -1 : 1;
      const bx = -Math.sin(yaw) * 3.8 * back + Math.cos(yaw) * 1.6 * side;
      const bz = -Math.cos(yaw) * 3.8 * back - Math.sin(yaw) * 1.6 * side;
      t.intensity = 0.5 + Math.min(1, Math.hypot(e.vx, e.vz) / 6) * 0.8;
      t.update(dt, this.tv.set(e.x + bx, y + 1.2, e.z + bz));
    }

    // battle damage: smoke and sparks pour out as hull drops
    const dmg = 1 - e.hp / e.maxHp;
    if (dmg > 0.35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.12 / dmg;
        const a = Math.random() * Math.PI * 2;
        const px = e.x + Math.cos(a) * 2, pz = e.z + Math.sin(a) * 2;
        this.g.smoke.trail(px, y + 2.5, pz, 1.4 + dmg * 1.5, 1.8);
        if (dmg > 0.6 && Math.random() < 0.5) this.g.particles.fireball(px, y + 2, pz, 0.5, 3);
        if (Math.random() < 0.3) this.g.particles.burst(px, y + 2, pz, this.g.colors.orange, 6, 6, 0.4, 0.3, 0.8);
      }
    }
  }
}
