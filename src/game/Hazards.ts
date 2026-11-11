import * as THREE from 'three';
import { rand } from '../core/util';
import type { Game } from './Game';

/**
 * Ground hazards used by boss signature attacks:
 *  - blast zones: telegraphed circles that detonate once
 *  - acid pools: telegraphed circles that linger and damage over time
 *  - sweep beams: rotating lasers anchored to a moving point
 */
interface Zone {
  kind: 'blast' | 'pool';
  x: number;
  z: number;
  r: number;
  warn: number;
  warnMax: number;
  life: number;
  dmg: number;
  tick: number;
  color: THREE.Color;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  active: boolean;
}

interface Beam {
  anchor: () => { x: number; z: number } | null;
  angle: number;
  speed: number;
  len: number;
  width: number;
  warn: number;
  life: number;
  dmg: number;
  color: THREE.Color;
  mesh: THREE.Mesh;
  core: THREE.Mesh;
  active: boolean;
}

export class Hazards {
  zones: Zone[] = [];
  beams: Beam[] = [];
  private ringGeo = new THREE.RingGeometry(0.92, 1, 64);
  private discGeo = new THREE.CircleGeometry(1, 48);
  private beamGeo: THREE.BoxGeometry;

  constructor(private scene: THREE.Scene, private g: Game) {
    this.ringGeo.rotateX(-Math.PI / 2);
    this.discGeo.rotateX(-Math.PI / 2);
    this.beamGeo = new THREE.BoxGeometry(1, 1, 1);
    this.beamGeo.translate(0, 0, 0.5);
  }

  private mat(c: THREE.Color, k: number) {
    return new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  private getZone(): Zone {
    let z = this.zones.find((q) => !q.active);
    if (!z) {
      const c = new THREE.Color(1, 0.2, 0.2);
      const ring = new THREE.Mesh(this.ringGeo, this.mat(c, 2));
      const fill = new THREE.Mesh(this.discGeo, this.mat(c, 1));
      ring.renderOrder = 3;
      fill.renderOrder = 3;
      this.scene.add(ring, fill);
      z = { kind: 'blast', x: 0, z: 0, r: 1, warn: 0, warnMax: 1, life: 0, dmg: 0, tick: 0, color: c, ring, fill, active: false };
      this.zones.push(z);
    }
    return z;
  }

  blast(x: number, z: number, r: number, warn: number, dmg: number, color = 0xff3a2a) {
    const q = this.getZone();
    Object.assign(q, { kind: 'blast', x, z, r, warn, warnMax: warn, life: 0.01, dmg, tick: 0, active: true });
    this.paint(q, color);
  }

  pool(x: number, z: number, r: number, warn: number, life: number, dmg: number, color = 0x5dff3a) {
    const q = this.getZone();
    Object.assign(q, { kind: 'pool', x, z, r, warn, warnMax: warn, life, dmg, tick: 0, active: true });
    this.paint(q, color);
  }

  private paint(q: Zone, color: number) {
    q.color.set(color);
    (q.ring.material as THREE.MeshBasicMaterial).color.copy(q.color).multiplyScalar(1.5);
    (q.fill.material as THREE.MeshBasicMaterial).color.copy(q.color).multiplyScalar(0.7);
    q.ring.position.set(q.x, 0.14, q.z);
    q.fill.position.set(q.x, 0.13, q.z);
    q.ring.scale.setScalar(q.r);
    q.fill.scale.setScalar(0.01);
    q.ring.visible = q.fill.visible = true;
  }

  sweep(anchor: () => { x: number; z: number } | null, angle: number, speed: number, len: number, width: number, warn: number, life: number, dmg: number, color = 0xff2a5a) {
    let b = this.beams.find((q) => !q.active);
    if (!b) {
      const c = new THREE.Color();
      const mesh = new THREE.Mesh(this.beamGeo, this.mat(c, 1));
      const core = new THREE.Mesh(this.beamGeo, this.mat(new THREE.Color(1, 1, 1), 0.9));
      mesh.renderOrder = core.renderOrder = 6;
      this.scene.add(mesh, core);
      b = { anchor, angle, speed, len, width, warn, life, dmg, color: c, mesh, core, active: false };
      this.beams.push(b);
    }
    Object.assign(b, { anchor, angle, speed, len, width, warn, life, dmg, active: true });
    b.color.set(color);
    (b.mesh.material as THREE.MeshBasicMaterial).color.copy(b.color).multiplyScalar(1.1);
    b.mesh.visible = b.core.visible = true;
  }

  clear() {
    for (const z of this.zones) {
      z.active = false;
      z.ring.visible = z.fill.visible = false;
    }
    for (const b of this.beams) {
      b.active = false;
      b.mesh.visible = b.core.visible = false;
    }
  }

  update(dt: number, time: number) {
    const g = this.g;
    const P = g.player;
    for (const q of this.zones) {
      if (!q.active) continue;
      const rm = q.ring.material as THREE.MeshBasicMaterial;
      const fm = q.fill.material as THREE.MeshBasicMaterial;
      if (q.warn > 0) {
        q.warn -= dt;
        const p = 1 - q.warn / q.warnMax;
        q.fill.scale.setScalar(Math.max(0.01, q.r * p));
        fm.opacity = 0.18 + p * 0.2;
        rm.opacity = 0.5 + 0.5 * Math.abs(Math.sin(time * (8 + p * 14)));
        if (q.warn <= 0) {
          if (q.kind === 'blast') {
            g.particles.burst(q.x, 0.6, q.z, q.color.clone().multiplyScalar(3), 26, q.r * 4, 0.5, 0.8, 0.8);
            g.fx.ring(q.x, q.z, q.r * 1.1, q.color, 0.3, 3);
            g.fx.scorch(q.x, q.z, q.r * 0.8);
            g.audio.sfx('boom');
            g.shake = Math.max(g.shake, 0.3);
            if (!P.dead && Math.hypot(P.x - q.x, P.z - q.z) < q.r + P.r * 0.5) g.hurtPlayer(q.dmg, null);
            q.active = false;
            q.ring.visible = q.fill.visible = false;
          } else {
            q.fill.scale.setScalar(q.r);
          }
        }
        continue;
      }
      // lingering pool
      q.life -= dt;
      fm.opacity = 0.32 + Math.sin(time * 5 + q.x) * 0.08;
      rm.opacity = 0.8;
      if (Math.random() < 0.5) {
        const a = rand(0, Math.PI * 2), d = Math.sqrt(Math.random()) * q.r;
        g.particles.emit(q.x + Math.cos(a) * d, 0.2, q.z + Math.sin(a) * d, 0, rand(1, 2.5), 0, 0.7, 0.35, q.color.clone().multiplyScalar(2.5), 0.5, 0);
      }
      q.tick -= dt;
      if (q.tick <= 0 && !P.dead && Math.hypot(P.x - q.x, P.z - q.z) < q.r) {
        q.tick = 0.5;
        g.hurtPlayer(q.dmg, null);
      }
      if (q.life <= 0) {
        q.active = false;
        q.ring.visible = q.fill.visible = false;
      }
    }

    for (const b of this.beams) {
      if (!b.active) continue;
      const a = b.anchor();
      if (!a) {
        b.active = false;
        b.mesh.visible = b.core.visible = false;
        continue;
      }
      const mm = b.mesh.material as THREE.MeshBasicMaterial;
      const cm = b.core.material as THREE.MeshBasicMaterial;
      b.mesh.position.set(a.x, 1.1, a.z);
      b.core.position.set(a.x, 1.1, a.z);
      b.mesh.rotation.y = b.core.rotation.y = b.angle;
      if (b.warn > 0) {
        b.warn -= dt;
        b.mesh.scale.set(0.15, 0.1, b.len);
        mm.opacity = 0.3 + 0.5 * Math.abs(Math.sin(time * 20));
        cm.opacity = 0;
        continue;
      }
      b.angle += b.speed * dt;
      b.life -= dt;
      const w = b.width * (1 + Math.sin(time * 40) * 0.08);
      b.mesh.scale.set(w, w * 0.6, b.len);
      b.core.scale.set(w * 0.3, w * 0.25, b.len);
      mm.opacity = 0.7;
      cm.opacity = 0.8;
      if (Math.random() < 0.6) {
        const t = rand(2, b.len);
        g.particles.emit(a.x + Math.sin(b.angle) * t, 0.3, a.z + Math.cos(b.angle) * t, rand(-2, 2), rand(1, 3), rand(-2, 2), 0.4, 0.5, b.color.clone().multiplyScalar(3), 2);
      }
      // damage check: point-to-segment distance on the ground plane
      if (!P.dead) {
        const dx = Math.sin(b.angle), dz = Math.cos(b.angle);
        const px = P.x - a.x, pz = P.z - a.z;
        const along = px * dx + pz * dz;
        if (along > 0 && along < b.len && Math.abs(px * dz - pz * dx) < b.width * 0.5 + P.r * 0.6) g.hurtPlayer(b.dmg, null);
      }
      if (b.life <= 0) {
        b.active = false;
        b.mesh.visible = b.core.visible = false;
      }
    }
  }
}
