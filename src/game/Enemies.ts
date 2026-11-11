import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import { alienMapper, dissolveDepthMaterial } from '../core/Assets';
import { rand, TAU, angleDiff } from '../core/util';
import { ARENA_RADIUS, EDEFS, hpScale, type EDef, type EType } from './data';
import { SpatialGrid } from './SpatialGrid';
import type { Game } from './Game';
import { SHIP_YAW } from './Player';

export interface Enemy {
  id: number;
  type: EType;
  def: EDef;
  x: number;
  z: number;
  vx: number;
  vz: number;
  kx: number;
  kz: number;
  r: number;
  hp: number;
  maxHp: number;
  spd: number;
  dmg: number;
  flash: number;
  yaw: number;
  tumble: number;
  st: number;
  timer: number;
  aimx: number;
  aimz: number;
  bladeCD: number;
  spawnT: number;
  dead: boolean;
  phase: number;
  sub: number;
  alpha: number;
  elite: boolean;
  slow: number;
  affix: '' | 'shielded' | 'regen' | 'volatile';
  shield: number;
}

const INSTANCED: EType[] = ['drone', 'dart', 'spitter', 'meteor', 'shard', 'brute', 'wraith', 'turret', 'bomber'];

interface Corpse {
  type: EType;
  x: number;
  z: number;
  y: number;
  yaw: number;
  tumble: number;
  size: number;
  t: number;
  vx: number;
  vz: number;
  spin: number;
  elite: boolean;
}

interface TypeRender {
  meshes: THREE.InstancedMesh[];
  flash: THREE.InstancedBufferAttribute;
  dissolve: THREE.InstancedBufferAttribute;
  max: number;
  eliteAt: Uint8Array;
  colorDirty: boolean;
}

let NEXT_ID = 1;

export class EnemyManager {
  list: Enemy[] = [];
  corpses: Corpse[] = [];
  private depthMat = dissolveDepthMaterial();
  private auras: THREE.Mesh[] = [];
  private auraMat(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uK: { value: 1 }, uMode: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uColor; uniform float uK; uniform float uMode; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
        void main(){
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
          float pat;
          if (uMode < 0.5) pat = 1.0 - smoothstep(0.0, 0.1, hex(vec2(vUv.x * 18.0, vUv.y * 9.0)));          // shield: hex cells
          else if (uMode < 1.5) pat = smoothstep(0.8, 1.0, sin(vUv.y * 30.0 + uTime * 6.0));                 // regen: rising bands
          else pat = 0.5 + 0.5 * sin(uTime * 14.0);                                                           // volatile: hazard pulse
          gl_FragColor = vec4(uColor * (f * 1.2 + pat * (0.25 + f)) * uK, 1.0);
        }`,
    });
  }
  grid = new SpatialGrid<Enemy>(3);
  render = new Map<EType, TypeRender>();
  private tmp: Enemy[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private eliteColor = new THREE.Color(1, 0.85, 0.3);
  private white = new THREE.Color(1, 1, 1);

  private scene: THREE.Scene;
  constructor(scene: THREE.Scene, assets: Assets, private g: Game) {
    this.scene = scene;
    for (const type of INSTANCED) {
      const def = EDEFS[type];
      const model = assets.get(def.model);
      const glow: Partial<Record<EType, number>> = { drone: 1.6, dart: 1.6, spitter: 1.3, brute: 0.75, wraith: 1.4, turret: 0.3, bomber: 1.2 };
      const mapper = alienMapper(def.color, glow[type] ?? 1.4, type === 'meteor' || type === 'shard' ? 1.6 : 1.1);
      const cap = def.max + 80; // room for dissolving corpses
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      flash.setUsage(THREE.DynamicDrawUsage);
      const dissolve = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      dissolve.setUsage(THREE.DynamicDrawUsage);
      const meshes: THREE.InstancedMesh[] = [];
      for (const part of model.parts) {
        const geo = part.geo.clone();
        geo.setAttribute('aFlash', flash);
        geo.setAttribute('aDissolve', dissolve);
        const mat = mapper(part.matName, part.mat);
        const im = new THREE.InstancedMesh(geo, mat, cap);
        im.count = 0;
        im.castShadow = true;
        im.customDepthMaterial = this.depthMat;
        im.frustumCulled = false;
        for (let i = 0; i < cap; i++) im.setColorAt(i, this.white);
        scene.add(im);
        meshes.push(im);
      }
      this.render.set(type, { meshes, flash, dissolve, max: cap, eliteAt: new Uint8Array(cap), colorDirty: false });
    }
  }

  count(type?: EType) {
    if (!type) return this.list.length;
    let n = 0;
    for (const e of this.list) if (e.type === type) n++;
    return n;
  }

  canSpawn(type: EType) {
    return this.count(type) < EDEFS[type].max;
  }

  spawn(type: EType, x: number, z: number, elite = false): Enemy | null {
    const def = EDEFS[type];
    if (type !== 'boss' && !this.canSpawn(type)) return null;
    const T = this.g.T;
    const hm = hpScale(T) * (elite ? 6 : 1);
    const e: Enemy = {
      id: NEXT_ID++,
      type, def, x, z, vx: 0, vz: 0, kx: 0, kz: 0,
      r: def.radius * (elite ? 1.35 : 1),
      hp: def.hp * hm, maxHp: def.hp * hm,
      spd: def.speed * (1 + Math.min(0.4, T / 1200)) * rand(0.92, 1.08),
      dmg: def.damage * (1 + T / 900) * (elite ? 1.4 : 1),
      flash: 0, yaw: rand(0, TAU), tumble: rand(0, TAU),
      st: 0, timer: rand(0.8, 2.5), aimx: 0, aimz: 1, bladeCD: 0,
      spawnT: 0.5, dead: false, phase: 0, sub: 0, alpha: 1, elite, slow: 0,
      affix: elite ? (['shielded', 'regen', 'volatile'] as const)[Math.floor(Math.random() * 3)] : '', shield: 0,
    };
    if (e.affix === 'shielded') e.shield = e.maxHp * 0.6;
    this.list.push(e);
    return e;
  }

  /** Keep a dissolving copy of a destroyed enemy for a short moment. */
  addCorpse(e: Enemy, kx = 0, kz = 0) {
    if (e.type === 'boss' || this.corpses.length > 160) return;
    this.corpses.push({
      type: e.type, x: e.x, z: e.z, y: e.def.hover, yaw: e.yaw, tumble: e.tumble, size: e.def.size * (e.elite ? 1.35 : 1),
      t: 0, vx: e.vx * 0.3 + kx, vz: e.vz * 0.3 + kz, spin: (Math.random() - 0.5) * 8, elite: e.elite,
    });
  }

  clear() {
    for (const a of this.auras) a.visible = false;
    this.corpses.length = 0;
    this.list.length = 0;
    this.grid.clear();
    for (const r of this.render.values()) for (const m of r.meshes) m.count = 0;
  }

  query(x: number, z: number, r: number): Enemy[] {
    return this.grid.query(x, z, r, this.tmp);
  }

  nearest(x: number, z: number, maxD: number, exclude?: Set<Enemy>): Enemy | null {
    let best: Enemy | null = null;
    let bd = maxD * maxD;
    for (const e of this.list) {
      if (e.dead || e.spawnT > 0.25 || (exclude && exclude.has(e))) continue;
      const dx = e.x - x, dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player;
    const R = ARENA_RADIUS - 0.8;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.dead) continue;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        if (Math.random() < 0.5) g.particles.emit(e.x + rand(-e.r, e.r), 0.1, e.z + rand(-e.r, e.r), 0, rand(3, 7), 0, 0.35, 0.35, g.colors.violet, 1, 0);
      }
      e.flash = Math.max(0, e.flash - dt);
      e.bladeCD -= dt;
      e.slow = Math.max(0, e.slow - dt);
      if (e.affix === 'regen' && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.04 * dt);
      const dx = P.x - e.x, dz = P.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      const spd = e.spd * (e.slow > 0 ? 0.5 : 1);
      let tx = ux * spd, tz = uz * spd;
      let steer = 5;

      switch (e.type) {
        case 'drone': {
          const w = Math.sin(g.time * 3 + e.id) * 0.45;
          tx = (ux - uz * w) * spd;
          tz = (uz + ux * w) * spd;
          break;
        }
        case 'dart': {
          e.timer -= dt;
          if (e.st === 0) {
            if (e.timer <= 0 && d < 15 && e.spawnT <= 0) {
              e.st = 1;
              e.timer = 0.65;
              e.aimx = ux;
              e.aimz = uz;
              g.fx.telegraph(e.x, e.z, Math.atan2(ux, uz), 15, 1.0, 0.65);
            }
          } else if (e.st === 1) {
            tx = tz = 0;
            steer = 10;
            if (e.timer <= 0) {
              e.st = 2;
              e.timer = 0.5;
              g.audio.sfx('dash');
            }
          } else {
            tx = e.aimx * spd * 6;
            tz = e.aimz * spd * 6;
            steer = 20;
            if (Math.random() < 0.6) g.particles.emit(e.x, 0.8, e.z, 0, 0.5, 0, 0.35, 0.5, g.colors.orange, 2);
            if (e.timer <= 0) {
              e.st = 0;
              e.timer = rand(1.8, 3);
            }
          }
          break;
        }
        case 'spitter': {
          if (d < 10) {
            tx = -ux * spd;
            tz = -uz * spd;
          } else if (d < 15) {
            const side = e.id % 2 ? 1 : -1;
            tx = -uz * spd * 0.8 * side;
            tz = ux * spd * 0.8 * side;
          }
          e.timer -= dt;
          if (e.timer <= 0 && d < 24 && e.spawnT <= 0) {
            e.timer = rand(2.0, 2.8);
            const n = e.elite ? 5 : g.T > 300 ? 3 : 1;
            for (let k = 0; k < n; k++) {
              const a = Math.atan2(ux, uz) + (k - (n - 1) / 2) * 0.22;
              g.proj.enemyShot(e.x, e.z, Math.sin(a) * 11, Math.cos(a) * 11, e.dmg * 0.9, 0x26ffb0);
            }
          }
          break;
        }
        case 'meteor':
        case 'shard':
          e.tumble += dt * 3;
          break;
        case 'brute':
          steer = 2;
          break;
        case 'wraith': {
          e.timer -= dt;
          if (e.timer <= 0 && d > 6 && d < 30 && e.spawnT <= 0) {
            // blink toward the player
            g.particles.burst(e.x, 1, e.z, g.colors.wraith, 16, 6, 0.4, 0.5);
            const jump = Math.min(d - 3, 9);
            e.x += ux * jump;
            e.z += uz * jump;
            g.particles.burst(e.x, 1, e.z, g.colors.wraith, 16, 6, 0.4, 0.5);
            e.timer = rand(2.2, 3.4);
          }
          const w = Math.sin(g.time * 2 + e.id) * 0.6;
          tx = (ux - uz * w) * spd;
          tz = (uz + ux * w) * spd;
          break;
        }
        case 'turret': {
          tx = tz = 0;
          steer = 10;
          e.timer -= dt;
          if (e.spawnT <= 0 && d < 26) {
            if (e.timer <= 0) {
              e.st = 3;
              e.timer = rand(2.6, 3.4);
              e.sub = 0;
            }
            if (e.st > 0) {
              e.sub -= dt;
              if (e.sub <= 0) {
                e.sub = 0.16;
                e.st--;
                const a = Math.atan2(ux, uz) + rand(-0.06, 0.06);
                g.proj.enemyShot(e.x + Math.sin(a) * 1.1, e.z + Math.cos(a) * 1.1, Math.sin(a) * 13, Math.cos(a) * 13, e.dmg, 0x39d0ff, 0.8);
                g.audio.sfx('shoot');
              }
            }
          }
          break;
        }
        case 'bomber': {
          e.timer -= dt;
          if (e.st === 0) {
            if (d < 7 && e.spawnT <= 0) {
              e.st = 1;
              e.timer = 0.6;
              g.fx.ring(e.x, e.z, 3.2, 0xff2a2a, 0.6, 2.5);
            }
          } else if (e.st === 1) {
            tx *= 0.15;
            tz *= 0.15;
            e.flash = Math.floor(e.timer * 20) % 2 ? 0.08 : 0;
            if (e.timer <= 0) {
              e.st = 2;
              e.timer = 0.9;
              e.aimx = ux;
              e.aimz = uz;
            }
          } else {
            tx = e.aimx * 13;
            tz = e.aimz * 13;
            steer = 14;
            if (e.timer <= 0 || d < e.r + P.r + 0.6) {
              g.detonate(e);
              continue;
            }
          }
          break;
        }
        case 'boss':
          g.boss.update(e, dt, ux, uz, d);
          tx = e.vx;
          tz = e.vz;
          steer = 0;
          break;
      }

      if (steer > 0) {
        const k = 1 - Math.exp(-steer * dt);
        e.vx += (tx - e.vx) * k;
        e.vz += (tz - e.vz) * k;
      }
      // knockback decays fast
      const kd = Math.exp(-7 * dt);
      e.x += (e.vx + e.kx) * dt;
      e.z += (e.vz + e.kz) * dt;
      e.kx *= kd;
      e.kz *= kd;

      // separation from neighbours
      if (e.type !== 'boss') {
        const near = this.grid.query(e.x, e.z, e.r + 1.4, this.tmp);
        let px = 0, pz = 0;
        for (let k = 0; k < near.length && k < 12; k++) {
          const o = near[k];
          if (o === e || o.dead) continue;
          const ox = e.x - o.x, oz = e.z - o.z;
          const rr = e.r + o.r;
          const dd = ox * ox + oz * oz;
          if (dd < rr * rr && dd > 0.0001) {
            const dl = Math.sqrt(dd);
            const push = (rr - dl) / dl;
            const wgt = o.type === 'boss' ? 1 : o.r / (e.r + o.r);
            px += ox * push * wgt;
            pz += oz * push * wgt;
          }
        }
        e.x += px * Math.min(1, dt * 10);
        e.z += pz * Math.min(1, dt * 10);
      }

      // arena bounds
      const rd = Math.hypot(e.x, e.z);
      const lim = R - e.r;
      if (rd > lim) {
        e.x *= lim / rd;
        e.z *= lim / rd;
        if (Math.random() < 0.02) g.arena.wallImpact(e.x, e.z, g.time);
      }

      // facing
      const sp = Math.hypot(e.vx, e.vz);
      if (e.type !== 'meteor' && e.type !== 'shard') {
        const target = e.type === 'turret' ? Math.atan2(dx, dz) : e.type === 'dart' && e.st === 1 ? Math.atan2(e.aimx, e.aimz) : sp > 0.3 ? Math.atan2(e.vx, e.vz) : e.yaw;
        e.yaw += angleDiff(e.yaw, target) * Math.min(1, dt * 8);
      }

      // contact damage
      if (e.spawnT <= 0 && !P.dead) {
        const cd = e.r + P.r * 0.85;
        if (dx * dx + dz * dz < cd * cd) g.hurtPlayer(e.dmg, e);
      }

      // relocate stragglers that fell far behind
      if (e.type !== 'boss' && d > 48) {
        const sp2 = g.spawnPoint(26, 32);
        e.x = sp2.x;
        e.z = sp2.z;
        e.vx = e.vz = 0;
      }
    }

    // age dissolving corpses
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      if (c.t >= 0.55) {
        this.corpses[i] = this.corpses[this.corpses.length - 1];
        this.corpses.pop();
        continue;
      }
      c.x += c.vx * dt;
      c.z += c.vz * dt;
      c.vx *= Math.exp(-5 * dt);
      c.vz *= Math.exp(-5 * dt);
      c.yaw += c.spin * dt;
      c.tumble += c.spin * 0.5 * dt;
    }

    // compact and rebuild grid
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.dead) this.list[w++] = e;
    }
    this.list.length = w;
    this.grid.clear();
    for (const e of this.list) this.grid.insert(e);
  }

  sync(time: number) {
    const counts = new Map<EType, number>();
    for (const e of this.list) {
      if (e.type === 'boss') continue;
      const r = this.render.get(e.type)!;
      const idx = counts.get(e.type) ?? 0;
      if (idx >= r.max) continue;
      counts.set(e.type, idx + 1);
      const def = e.def;
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.5 : 1;
      const ease = 1 - Math.pow(1 - Math.max(0, spawnK), 3);
      let sc = def.size * (e.elite ? 1.35 : 1) * ease;
      let y = def.hover + Math.sin(time * 2.5 + e.id) * 0.15;
      if (e.spawnT > 0) y += (1 - ease) * 6; // drop in from above
      let pitch = 0, roll = 0;
      if (e.type === 'meteor' || e.type === 'shard') {
        pitch = e.tumble;
        roll = e.tumble * 0.6;
      } else {
        const bank = Math.sin(time * 2 + e.id) * 0.15;
        roll = bank;
      }
      if (e.type === 'bomber') {
        pitch = Math.PI / 2;
        roll = time * 8;
      }
      if (e.type === 'dart' && e.st === 1) {
        sc *= 1 + Math.sin(time * 40) * 0.06;
        pitch = -0.25;
      }
      const yawOff = e.type === 'meteor' || e.type === 'shard' || e.type === 'bomber' ? 0 : SHIP_YAW;
      this.e.set(pitch, e.yaw + yawOff, roll, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(e.x, y, e.z);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      r.flash.array[idx] = e.flash > 0 ? Math.min(1, e.flash * 14) : 0;
      r.dissolve.array[idx] = e.spawnT > 0 ? Math.max(0, e.spawnT / 0.5 - 0.15) : 0;
      const el = e.elite ? 1 : 0;
      const recolor = r.eliteAt[idx] !== el;
      if (recolor) {
        r.eliteAt[idx] = el;
        r.colorDirty = true;
      }
      for (const mesh of r.meshes) {
        mesh.setMatrixAt(idx, this.m);
        if (recolor) mesh.setColorAt(idx, el ? this.eliteColor : this.white);
      }
    }
    // dissolving corpses (aged in update())
    for (let i = 0; i < this.corpses.length; i++) {
      const c = this.corpses[i];
      const r = this.render.get(c.type);
      if (!r) continue;
      const idx = counts.get(c.type) ?? 0;
      if (idx >= r.max) continue;
      counts.set(c.type, idx + 1);
      const p = Math.min(1, c.t / 0.55);
      const yawOff = c.type === 'meteor' || c.type === 'shard' || c.type === 'bomber' ? 0 : SHIP_YAW;
      this.e.set(c.type === 'bomber' ? Math.PI / 2 : c.tumble * 0.3 + p * 0.6, c.yaw + yawOff, p * 0.8, 'YXZ');
      this.q.setFromEuler(this.e);
      const sc = c.size * (1 + p * 0.15);
      this.m.compose(this.p.set(c.x, c.y - p * 0.6, c.z), this.q, this.s.set(sc, sc, sc));
      r.flash.array[idx] = p < 0.15 ? 1 - p / 0.15 : 0;
      r.dissolve.array[idx] = 0.08 + p * 0.95;
      const el = c.elite ? 1 : 0;
      if (r.eliteAt[idx] !== el) {
        r.eliteAt[idx] = el;
        r.colorDirty = true;
        for (const mesh of r.meshes) mesh.setColorAt(idx, el ? this.eliteColor : this.white);
      }
      for (const mesh of r.meshes) mesh.setMatrixAt(idx, this.m);
    }
    // affix auras around elites
    let ai = 0;
    for (const e of this.list) {
      if (!e.affix || e.dead) continue;
      let m = this.auras[ai];
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.auraMat());
        m.renderOrder = 5;
        this.scene.add(m);
        this.auras.push(m);
      }
      ai++;
      const u = (m.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = time;
      u.uMode.value = e.affix === 'shielded' ? 0 : e.affix === 'regen' ? 1 : 2;
      (u.uColor.value as THREE.Color).set(e.affix === 'shielded' ? 0x6fd8ff : e.affix === 'regen' ? 0x6dff8a : 0xff4a2a);
      u.uK.value = e.affix === 'shielded' ? (e.shield > 0 ? 0.8 : 0) : 0.4;
      m.visible = e.affix !== 'shielded' || e.shield > 0;
      m.position.set(e.x, e.def.hover + 0.4, e.z);
      m.scale.setScalar(e.r * 2.2 * (e.affix === 'volatile' ? 1 + Math.sin(time * 14) * 0.05 : 1));
    }
    for (let i = ai; i < this.auras.length; i++) this.auras[i].visible = false;

    for (const [type, r] of this.render) {
      const n = counts.get(type) ?? 0;
      for (const mesh of r.meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (r.colorDirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      r.colorDirty = false;
      r.flash.needsUpdate = true;
      r.dissolve.needsUpdate = true;
    }
  }
}
