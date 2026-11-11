import * as THREE from 'three';
import type { Assets, ModelName } from '../core/Assets';
import { heroMapper } from '../core/Assets';
import { rand, TAU } from '../core/util';
import type { Game } from './Game';

interface Gem { x: number; z: number; vx: number; vz: number; v: number; mag: boolean; t: number; y: number; vy: number }
export type PowerKind = 'heal' | 'magnet' | 'bomb';
interface Power { kind: PowerKind; x: number; z: number; t: number; obj: THREE.Group; beam: THREE.Mesh }

const GEM_COLORS = [
  new THREE.Color(0.3, 0.95, 1).multiplyScalar(3.2),
  new THREE.Color(0.45, 1, 0.55).multiplyScalar(3.2),
  new THREE.Color(0.8, 0.45, 1).multiplyScalar(3.5),
  new THREE.Color(1, 0.8, 0.25).multiplyScalar(3.8),
];
const POWER_DEF: Record<PowerKind, { model: ModelName; color: number; size: number }> = {
  heal: { model: 'barrel', color: 0xff4f6a, size: 1.6 },
  magnet: { model: 'satelliteDish_detailed', color: 0x4fffe0, size: 1.6 },
  bomb: { model: 'machine_barrel', color: 0xffaa33, size: 1.5 },
};

export class Pickups {
  gems: Gem[] = [];
  powers: Power[] = [];
  gemMesh: THREE.InstancedMesh;
  max = 600;
  pickStreak = 0;
  pickStreakT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private beamGeo: THREE.CylinderGeometry;

  constructor(private scene: THREE.Scene, private assets: Assets, private g: Game) {
    const geo = new THREE.OctahedronGeometry(0.28, 0);
    geo.scale(1, 1.6, 1);
    this.gemMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.max);
    this.gemMesh.count = 0;
    this.gemMesh.frustumCulled = false;
    for (let i = 0; i < this.max; i++) this.gemMesh.setColorAt(i, GEM_COLORS[0]);
    scene.add(this.gemMesh);
    this.beamGeo = new THREE.CylinderGeometry(0.35, 0.6, 9, 16, 1, true);
    this.beamGeo.translate(0, 4.5, 0);
  }

  clear() {
    this.gems.length = 0;
    for (const p of this.powers) this.scene.remove(p.obj, p.beam);
    this.powers.length = 0;
  }

  dropGem(x: number, z: number, v: number) {
    if (this.gems.length >= this.max) {
      // fold into the oldest gem so value is never lost
      const o = this.gems[0];
      o.v += v;
      return;
    }
    const a = rand(0, TAU);
    const s = rand(1, 3);
    this.gems.push({ x, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, v, mag: false, t: 0, y: 1.2, vy: rand(3, 6) });
  }

  dropPower(kind: PowerKind, x: number, z: number) {
    const def = POWER_DEF[kind];
    const obj = this.assets.object(def.model, def.size, heroMapper(def.color, 2.5));
    obj.position.set(x, 0.4, z);
    const beam = new THREE.Mesh(
      this.beamGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).multiplyScalar(1.4), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.set(x, 0, z);
    this.scene.add(obj, beam);
    this.powers.push({ kind, x, z, t: 0, obj, beam });
  }

  magnetAll() {
    for (const gm of this.gems) gm.mag = true;
  }

  private gemColor(v: number) {
    return v >= 20 ? GEM_COLORS[3] : v >= 5 ? GEM_COLORS[2] : v >= 2 ? GEM_COLORS[1] : GEM_COLORS[0];
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player;
    this.pickStreakT -= dt;
    if (this.pickStreakT <= 0) this.pickStreak = 0;
    const mr = P.magnet;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const gm = this.gems[i];
      gm.t += dt;
      // pop-out arc
      if (gm.y > 0.6 || gm.vy > 0) {
        gm.vy -= 18 * dt;
        gm.y = Math.max(0.6, gm.y + gm.vy * dt);
        if (gm.y <= 0.6) gm.vy = 0;
      }
      const dx = P.x - gm.x, dz = P.z - gm.z;
      const d = Math.hypot(dx, dz);
      if (!P.dead && (gm.mag || d < mr)) {
        gm.mag = true;
        const sp = 10 + gm.t * 4 + (gm.mag ? 18 : 0);
        gm.vx += ((dx / (d || 1)) * sp - gm.vx) * Math.min(1, dt * 8);
        gm.vz += ((dz / (d || 1)) * sp - gm.vz) * Math.min(1, dt * 8);
      } else {
        gm.vx *= Math.exp(-4 * dt);
        gm.vz *= Math.exp(-4 * dt);
      }
      gm.x += gm.vx * dt;
      gm.z += gm.vz * dt;
      if (!P.dead && d < P.r + 0.6) {
        this.pickStreak++;
        this.pickStreakT = 0.6;
        g.gainXp(gm.v);
        g.audio.sfx('pick', this.pickStreak);
        g.particles.emit(gm.x, 1, gm.z, 0, 2, 0, 0.25, 0.7, this.gemColor(gm.v), 2);
        this.gems[i] = this.gems[this.gems.length - 1];
        this.gems.pop();
      }
    }

    for (let i = this.powers.length - 1; i >= 0; i--) {
      const p = this.powers[i];
      p.t += dt;
      p.obj.rotation.y += dt * 1.8;
      p.obj.position.y = 0.5 + Math.sin(p.t * 3) * 0.25;
      const fading = p.t > 22;
      const vis = !fading || Math.floor(p.t * 8) % 2 === 0;
      p.obj.visible = vis;
      (p.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(p.t * 4) * 0.06;
      p.beam.visible = vis;
      const d = Math.hypot(P.x - p.x, P.z - p.z);
      if (!P.dead && d < P.r + 1.1) {
        g.collectPower(p.kind, p.x, p.z);
        this.scene.remove(p.obj, p.beam);
        this.powers.splice(i, 1);
      } else if (p.t > 26) {
        this.scene.remove(p.obj, p.beam);
        this.powers.splice(i, 1);
      }
    }
  }

  sync(time: number) {
    for (let i = 0; i < this.gems.length; i++) {
      const gm = this.gems[i];
      const sc = gm.v >= 20 ? 2 : gm.v >= 5 ? 1.5 : gm.v >= 2 ? 1.2 : 1;
      this.e.set(0, time * 2.5 + i, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(gm.x, gm.y + Math.sin(time * 4 + i) * 0.12, gm.z), this.q, this.s.set(sc, sc, sc));
      this.gemMesh.setMatrixAt(i, this.m);
      this.gemMesh.setColorAt(i, this.gemColor(gm.v));
    }
    this.gemMesh.count = this.gems.length;
    this.gemMesh.instanceMatrix.needsUpdate = true;
    if (this.gemMesh.instanceColor) this.gemMesh.instanceColor.needsUpdate = true;
  }
}
