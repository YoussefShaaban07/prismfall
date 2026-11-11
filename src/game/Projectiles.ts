import * as THREE from 'three';
import { rand, TAU } from '../core/util';
import { ARENA_RADIUS } from './data';
import type { Enemy } from './Enemies';
import type { Game } from './Game';

interface Bolt { x: number; z: number; vx: number; vz: number; dmg: number; pierce: number; life: number; hit: Set<number>; color: THREE.Color; r: number }
interface Missile { x: number; z: number; vx: number; vz: number; dmg: number; blast: number; life: number; target: Enemy | null; y: number }
interface EShot { x: number; z: number; vx: number; vz: number; dmg: number; life: number; color: THREE.Color; size: number }

function instanced(geo: THREE.BufferGeometry, max: number, scene: THREE.Scene) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), max);
  m.count = 0;
  m.frustumCulled = false;
  const c = new THREE.Color(1, 1, 1);
  for (let i = 0; i < max; i++) m.setColorAt(i, c);
  scene.add(m);
  return m;
}

export class Projectiles {
  bolts: Bolt[] = [];
  missiles: Missile[] = [];
  shots: EShot[] = [];
  boltMesh: THREE.InstancedMesh;
  missileMesh: THREE.InstancedMesh;
  shotMesh: THREE.InstancedMesh;
  shotCore: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private missileColor = new THREE.Color(1, 0.6, 0.2).multiplyScalar(5);

  constructor(scene: THREE.Scene, private g: Game) {
    const bg = new THREE.CapsuleGeometry(0.11, 1.1, 4, 8);
    bg.rotateX(Math.PI / 2);
    this.boltMesh = instanced(bg, 700, scene);
    const mg = new THREE.ConeGeometry(0.18, 0.8, 8);
    mg.rotateX(Math.PI / 2);
    this.missileMesh = instanced(mg, 120, scene);
    this.shotMesh = instanced(new THREE.IcosahedronGeometry(0.34, 1), 900, scene);
    (this.shotMesh.material as THREE.MeshBasicMaterial).transparent = true;
    (this.shotMesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
    (this.shotMesh.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending;
    (this.shotMesh.material as THREE.MeshBasicMaterial).depthWrite = false;
    this.shotCore = instanced(new THREE.IcosahedronGeometry(0.18, 1), 900, scene);
  }

  bolt(x: number, z: number, angle: number, speed: number, dmg: number, pierce: number, color: THREE.Color) {
    if (this.bolts.length > 690) return;
    this.bolts.push({ x, z, vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed, dmg, pierce, life: 1.1, hit: new Set(), color, r: 0.35 });
  }

  missile(x: number, z: number, angle: number, dmg: number, blast: number, target: Enemy | null) {
    if (this.missiles.length > 118) return;
    const s = 9;
    this.missiles.push({ x, z, vx: Math.sin(angle) * s, vz: Math.cos(angle) * s, dmg, blast, life: 3.2, target, y: 1.2 });
  }

  enemyShot(x: number, z: number, vx: number, vz: number, dmg: number, color: number, size = 1) {
    if (this.shots.length > 890) return;
    if (this.g.mods.has('hardlight')) { vx *= 1.3; vz *= 1.3; }
    const c = this.g.settings.contrast ? new THREE.Color(1, 0.95, 0.1).multiplyScalar(1.6) : new THREE.Color(color).multiplyScalar(1.5);
    this.shots.push({ x, z, vx, vz, dmg, life: 6, color: c, size });
  }

  clear() {
    this.bolts.length = 0;
    this.missiles.length = 0;
    this.shots.length = 0;
  }

  clearEnemyShots(burst = true) {
    if (burst) for (const s of this.shots) this.g.particles.emit(s.x, 1, s.z, 0, 2, 0, 0.4, 0.5, s.color, 2);
    this.shots.length = 0;
  }

  explode(x: number, z: number, radius: number, dmg: number, color: THREE.Color, knock = 6, scorch = true) {
    const g = this.g;
    const hits = g.enemies.query(x, z, radius + 3);
    for (const e of hits) {
      if (e.dead) continue;
      const dx = e.x - x, dz = e.z - z;
      const d = Math.hypot(dx, dz);
      if (d < radius + e.r) {
        const k = d > 0.01 ? knock / d : 0;
        g.damage(e, dmg, dx * k, dz * k);
      }
    }
    g.particles.burst(x, 1, z, color, 18, radius * 4, 0.55, 0.9, 0.6);
    g.particles.fireball(x, 0.8, z, radius * 0.45, 10);
    g.smoke.puff(x, 0.8, z, 4, radius * 0.5, 1.4);
    g.particles.burst(x, 1, z, g.colors.white, 8, radius * 2, 0.3, 1.2, 0.5);
    g.fx.ring(x, z, radius * 1.15, color, 0.35, 3);
    g.fx.shock(x, z, radius * 2.2, 0.7, 0.4);
    if (scorch && Math.random() < 0.5) g.fx.scorch(x, z, radius * 0.8);
    g.debris.spawn(x, 0.6, z, g.colors.debris, 3, 6, 0.8);
    g.shake = Math.max(g.shake, 0.35);
    g.audio.sfx('boom');
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player;
    const lim = ARENA_RADIUS + 4;

    // player bolts
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      let dead = b.life <= 0 || Math.hypot(b.x, b.z) > lim;
      if (!dead) {
        const near = g.enemies.query(b.x, b.z, 3.5);
        for (const e of near) {
          if (e.dead || b.hit.has(e.id)) continue;
          const rr = e.r + b.r;
          const dx = e.x - b.x, dz = e.z - b.z;
          if (dx * dx + dz * dz < rr * rr) {
            b.hit.add(e.id);
            const sp = Math.hypot(b.vx, b.vz);
            g.damage(e, b.dmg, (b.vx / sp) * 3, (b.vz / sp) * 3);
            g.particles.burst(b.x, 1, b.z, b.color, 4, 6, 0.25, 0.35, 0.3);
            if (b.pierce-- <= 0) {
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) {
        this.bolts[i] = this.bolts[this.bolts.length - 1];
        this.bolts.pop();
      }
    }

    // missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.life -= dt;
      if (!m.target || m.target.dead) m.target = g.enemies.nearest(m.x, m.z, 30);
      const sp = Math.min(24, Math.hypot(m.vx, m.vz) + 28 * dt);
      if (m.target) {
        const dx = m.target.x - m.x, dz = m.target.z - m.z;
        const d = Math.hypot(dx, dz) || 1;
        const turn = Math.min(1, dt * 6);
        m.vx += ((dx / d) * sp - m.vx) * turn;
        m.vz += ((dz / d) * sp - m.vz) * turn;
      }
      const v = Math.hypot(m.vx, m.vz) || 1;
      m.vx = (m.vx / v) * sp;
      m.vz = (m.vz / v) * sp;
      m.x += m.vx * dt;
      m.z += m.vz * dt;
      g.particles.emit(m.x - (m.vx / sp) * 0.5, m.y, m.z - (m.vz / sp) * 0.5, rand(-0.5, 0.5), 0.6, rand(-0.5, 0.5), 0.4, 0.55, g.colors.flame, 1.5);
      if (Math.random() < 0.55) g.smoke.trail(m.x, m.y, m.z, 0.45, 0.8);
      let boom = m.life <= 0 || Math.hypot(m.x, m.z) > lim;
      if (!boom) {
        const near = g.enemies.query(m.x, m.z, 3);
        for (const e of near) {
          if (e.dead) continue;
          const rr = e.r + 0.4;
          if ((e.x - m.x) ** 2 + (e.z - m.z) ** 2 < rr * rr) {
            boom = true;
            break;
          }
        }
      }
      if (boom) {
        this.explode(m.x, m.z, m.blast, m.dmg, g.colors.orange);
        this.missiles[i] = this.missiles[this.missiles.length - 1];
        this.missiles.pop();
      }
    }

    // enemy shots
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      let dead = s.life <= 0 || Math.hypot(s.x, s.z) > lim;
      if (!dead && !P.dead) {
        const rr = 0.3 * s.size + P.r * 0.7;
        if ((s.x - P.x) ** 2 + (s.z - P.z) ** 2 < rr * rr) {
          if (!P.dashing) {
            g.hurtPlayer(s.dmg, null);
            dead = true;
          }
        }
      }
      if (dead) {
        this.shots[i] = this.shots[this.shots.length - 1];
        this.shots.pop();
      }
    }
  }

  sync(time: number) {
    // bolts
    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i];
      this.e.set(0, Math.atan2(b.vx, b.vz), 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(b.x, 1.0, b.z), this.q, this.s.set(1, 1, 1));
      this.boltMesh.setMatrixAt(i, this.m);
      this.boltMesh.setColorAt(i, b.color);
    }
    this.boltMesh.count = this.bolts.length;
    this.boltMesh.instanceMatrix.needsUpdate = true;
    if (this.boltMesh.instanceColor) this.boltMesh.instanceColor.needsUpdate = true;

    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i];
      this.e.set(0, Math.atan2(m.vx, m.vz), 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(m.x, m.y, m.z), this.q, this.s.set(1, 1, 1));
      this.missileMesh.setMatrixAt(i, this.m);
      this.missileMesh.setColorAt(i, this.missileColor);
    }
    this.missileMesh.count = this.missiles.length;
    this.missileMesh.instanceMatrix.needsUpdate = true;
    if (this.missileMesh.instanceColor) this.missileMesh.instanceColor.needsUpdate = true;

    for (let i = 0; i < this.shots.length; i++) {
      const s = this.shots[i];
      const pulse = s.size * (1 + Math.sin(time * 14 + i) * 0.15);
      this.q.identity();
      this.m.compose(this.p.set(s.x, 1.0, s.z), this.q, this.s.set(pulse, pulse, pulse));
      this.shotMesh.setMatrixAt(i, this.m);
      this.shotMesh.setColorAt(i, s.color);
      this.shotCore.setMatrixAt(i, this.m);
      this.c.copy(s.color).multiplyScalar(0.7).addScalar(0.35);
      this.shotCore.setColorAt(i, this.c);
    }
    for (const mesh of [this.shotMesh, this.shotCore]) {
      mesh.count = this.shots.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    void TAU;
  }
}
