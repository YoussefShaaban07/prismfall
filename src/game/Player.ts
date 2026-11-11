import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import { heroMapper } from '../core/Assets';
import type { Input } from '../core/Input';
import { angleDiff, clamp, damp } from '../core/util';
import { ARENA_RADIUS, xpForLevel, type PassiveId, type WeaponId } from './data';

/** Kenney ships point down -Z in model space; rotate so +Z (our "forward") matches. */
export const SHIP_YAW = Math.PI;

export class Player {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  r = 0.75;
  ang = 0; // heading, radians; 0 = +Z
  bank = 0;
  hp = 100;
  maxHp = 100;
  inv = 0;
  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  speed = 9;
  magnet = 4;
  dmg = 1;
  cd = 1;
  area = 1;
  regen = 0;
  armor = 0;
  dashCD = 0;
  dashMax = 2.4;
  dashT = 0;
  dashX = 0;
  dashZ = 1;
  dead = false;
  weapons = new Map<WeaponId, number>();
  passives = new Map<PassiveId, number>();
  evolved = new Set<WeaponId>();

  root = new THREE.Group();
  ship: THREE.Group;
  flames: THREE.Mesh[] = [];
  shield: THREE.Mesh;
  light: THREE.PointLight;
  magnetRing: THREE.Mesh;

  constructor(scene: THREE.Scene, assets: Assets) {
    this.ship = assets.object('craft_speederA', 2.4, heroMapper(0x37e8ff, 1.8));
    this.ship.rotation.y = SHIP_YAW;
    const holder = new THREE.Group();
    holder.add(this.ship);
    this.root.add(holder);
    this.root.userData.holder = holder;

    // engine flames
    const fGeo = new THREE.ConeGeometry(0.16, 1, 10, 1, true);
    fGeo.rotateX(-Math.PI / 2);
    fGeo.translate(0, 0, -0.5);
    const fMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 1).multiplyScalar(6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-0.42, 0.42]) {
      const f = new THREE.Mesh(fGeo, fMat);
      f.position.set(sx, 0.38, -1.0);
      holder.add(f);
      this.flames.push(f);
    }

    // dash / i-frame shield
    this.shield = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.5, 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.95, 1).multiplyScalar(1.5), transparent: true, opacity: 0, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.shield.position.y = 0.5;
    this.root.add(this.shield);

    // magnet range indicator
    const mr = new THREE.RingGeometry(0.97, 1, 96);
    mr.rotateX(-Math.PI / 2);
    this.magnetRing = new THREE.Mesh(
      mr,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.85), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.magnetRing.position.y = 0.08;
    scene.add(this.magnetRing);

    this.light = new THREE.PointLight(0x4fe6ff, 7, 14, 1.6);
    this.light.position.y = 2.5;
    this.root.add(this.light);
    scene.add(this.root);
  }

  reset() {
    Object.assign(this, {
      x: 0, z: 0, vx: 0, vz: 0, ang: 0, bank: 0, hp: 100, maxHp: 100, inv: 0, level: 1, xp: 0,
      xpNext: xpForLevel(1), speed: 9, magnet: 4, dmg: 1, cd: 1, area: 1, regen: 0, armor: 0,
      dashCD: 0, dashMax: 2.4, dashT: 0, dead: false,
    });
    this.weapons.clear();
    this.passives.clear();
    this.evolved.clear();
    this.weapons.set('blaster', 1);
    this.root.visible = true;
  }

  get dashing() {
    return this.dashT > 0;
  }

  /** returns true if a dash started this frame */
  update(dt: number, input: Input, time: number): boolean {
    let dashed = false;
    if (this.dead) return false;
    this.inv = Math.max(0, this.inv - dt);
    this.dashCD = Math.max(0, this.dashCD - dt);
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);

    const mx = input.moveX;
    const mz = input.moveY;
    const mlen = Math.hypot(mx, mz);
    if (input.consumeDash() && this.dashCD <= 0) {
      const dx = mlen > 0.1 ? mx / mlen : Math.sin(this.ang);
      const dz = mlen > 0.1 ? mz / mlen : Math.cos(this.ang);
      this.dashX = dx;
      this.dashZ = dz;
      this.dashT = 0.2;
      this.dashCD = this.dashMax;
      this.inv = Math.max(this.inv, 0.35);
      dashed = true;
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.vx = this.dashX * this.speed * 3.6;
      this.vz = this.dashZ * this.speed * 3.6;
    } else {
      const tx = mx * this.speed;
      const tz = mz * this.speed;
      this.vx = damp(this.vx, tx, 12, dt);
      this.vz = damp(this.vz, tz, 12, dt);
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const R = ARENA_RADIUS - this.r - 0.3;
    const d = Math.hypot(this.x, this.z);
    if (d > R) {
      this.x *= R / d;
      this.z *= R / d;
    }

    const sp = Math.hypot(this.vx, this.vz);
    let turn = 0;
    if (sp > 0.5) {
      const target = Math.atan2(this.vx, this.vz);
      turn = angleDiff(this.ang, target);
      this.ang += turn * Math.min(1, dt * 12);
    }
    this.bank = damp(this.bank, clamp(-turn * 1.2, -0.7, 0.7), 8, dt);

    // visuals
    const holder = this.root.userData.holder as THREE.Group;
    this.root.position.set(this.x, 0, this.z);
    holder.rotation.set(0, this.ang, 0);
    holder.position.y = 0.55 + Math.sin(time * 3.2) * 0.12;
    this.ship.rotation.z = this.bank;
    this.ship.rotation.x = -Math.min(0.25, sp * 0.02);
    const thrust = 0.5 + Math.min(1, sp / this.speed) * 0.9 + (this.dashing ? 1.6 : 0);
    for (const f of this.flames) {
      f.scale.set(1, 1, thrust * (0.85 + Math.random() * 0.3));
    }
    const sm = this.shield.material as THREE.MeshBasicMaterial;
    sm.opacity = damp(sm.opacity, this.inv > 0 ? 0.55 : 0, 14, dt);
    this.shield.rotation.y += dt * 2;
    this.shield.rotation.x += dt * 1.3;
    // blink on damage i-frames (not dash)
    this.ship.visible = !(this.inv > 0 && !this.dashing && Math.floor(time * 20) % 2 === 0);
    this.magnetRing.position.set(this.x, 0.08, this.z);
    this.magnetRing.scale.setScalar(this.magnet);
    return dashed;
  }
}
