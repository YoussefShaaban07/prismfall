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
  /** a falling bomb that lands as the warning runs out (carpet bombing) */
  shell: THREE.Group | null;
  shellTrail: number;
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

  /** Zone interior: blast warnings pulse inward toward the impact; acid pools bubble and churn. */
  private fillMat() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color() }, uOp: { value: 0.3 }, uTime: { value: 0 }, uKind: { value: 0 }, uSeed: { value: 0 }, uP: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOp; uniform float uTime; uniform float uKind; uniform float uSeed; uniform float uP; varying vec2 vUv;
        vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
        float cells(vec2 p, float t){
          vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 o = vec2(x, y); vec2 h = h22(i + o);
            vec2 q = o + 0.5 + 0.4 * sin(t + 6.2831 * h) - f; float d = dot(q, q);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return sqrt(d2) - sqrt(d1);
        }
        void main(){
          vec2 p = (vUv - 0.5) * 2.0; float r = length(p);
          if (r > 1.0) discard;
          float a;
          if (uKind < 0.5) {
            // blast warning: rings sweep in toward the impact point, faster as it nears
            float w = fract(r * 3.0 + uTime * (1.5 + uP * 4.0));
            a = 0.35 + smoothstep(0.75, 1.0, w) * 0.9 + (1.0 - r) * uP * 0.6;
          } else {
            // acid: churning caustic cells, bright bubble rims, a toxic edge
            vec2 q = p * 3.2 + uSeed;
            float c = cells(q, uTime * 1.3);
            float caustic = 1.0 - smoothstep(0.0, 0.12, c);
            float b = cells(q * 2.3 + 11.0, uTime * 2.6);
            float bub = smoothstep(0.03, 0.0, abs(b - 0.18)) * step(0.6, fract(sin(dot(floor(q * 2.3), vec2(7.1, 3.3))) * 91.7 + uTime * 0.4));
            a = 0.45 + caustic * 0.9 + bub * 1.2 + smoothstep(0.75, 1.0, r) * 0.8;
          }
          gl_FragColor = vec4(uColor * a * uOp, 1.0);
        }`,
    });
  }

  private shellPool: THREE.Group[] = [];
  private getShell() {
    const s = this.shellPool.pop();
    if (s) return s;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.0, 4, 10), new THREE.MeshStandardMaterial({ color: 0x23202a, metalness: 0.6, roughness: 0.4, emissive: new THREE.Color(1, 0.35, 0.1), emissiveIntensity: 0.4 }));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.2).multiplyScalar(4), toneMapped: false }));
    tip.position.y = -0.7;
    g.add(body, tip);
    this.scene.add(g);
    return g;
  }

  private mat(c: THREE.Color, k: number) {
    return new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  private getZone(): Zone {
    let z = this.zones.find((q) => !q.active);
    if (!z) {
      const c = new THREE.Color(1, 0.2, 0.2);
      const ring = new THREE.Mesh(this.ringGeo, this.mat(c, 2));
      const fill = new THREE.Mesh(this.discGeo, this.fillMat());
      ring.renderOrder = 3;
      fill.renderOrder = 3;
      this.scene.add(ring, fill);
      z = { kind: 'blast', x: 0, z: 0, r: 1, warn: 0, warnMax: 1, life: 0, dmg: 0, tick: 0, color: c, ring, fill, active: false, shell: null, shellTrail: 0 };
      this.zones.push(z);
    }
    return z;
  }

  blast(x: number, z: number, r: number, warn: number, dmg: number, color = 0xff3a2a, shell = false) {
    const q = this.getZone();
    Object.assign(q, { kind: 'blast', x, z, r, warn, warnMax: warn, life: 0.01, dmg, tick: 0, active: true });
    this.paint(q, color);
    if (shell) {
      q.shell = this.getShell();
      q.shell.visible = false;
      q.shell.rotation.set(rand(-0.15, 0.15), 0, rand(-0.15, 0.15));
    }
  }

  private dropShell(q: Zone) {
    if (!q.shell) return;
    q.shell.visible = false;
    this.shellPool.push(q.shell);
    q.shell = null;
  }

  pool(x: number, z: number, r: number, warn: number, life: number, dmg: number, color = 0x5dff3a) {
    const q = this.getZone();
    Object.assign(q, { kind: 'pool', x, z, r, warn, warnMax: warn, life, dmg, tick: 0, active: true });
    this.paint(q, color);
  }

  private paint(q: Zone, color: number) {
    q.color.set(color);
    (q.ring.material as THREE.MeshBasicMaterial).color.copy(q.color).multiplyScalar(1.5);
    const fu = (q.fill.material as THREE.ShaderMaterial).uniforms;
    fu.uColor.value.copy(q.color).multiplyScalar(0.7);
    fu.uKind.value = q.kind === 'pool' ? 1 : 0;
    fu.uSeed.value = rand(0, 50);
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
      this.dropShell(z);
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
      const fu = (q.fill.material as THREE.ShaderMaterial).uniforms;
      fu.uTime.value = time;
      if (q.warn > 0) {
        q.warn -= dt;
        const p = 1 - q.warn / q.warnMax;
        q.fill.scale.setScalar(Math.max(0.01, q.r * p));
        fu.uOp.value = 0.18 + p * 0.2;
        fu.uP.value = p;
        if (q.shell) {
          // the shell drops in over the last 0.8 s, trailing smoke, and lands as the warning ends
          const fall = Math.min(1, q.warn / 0.8);
          q.shell.visible = q.warn < 0.8;
          q.shell.position.set(q.x + fall * 2.5, 0.7 + fall * fall * 30, q.z - fall * 1.2);
          q.shellTrail -= dt;
          if (q.shell.visible && q.shellTrail <= 0) {
            q.shellTrail = 0.03;
            g.smoke.trail(q.shell.position.x, q.shell.position.y + 0.8, q.shell.position.z, 0.7, 0.7);
          }
        }
        rm.opacity = 0.5 + 0.5 * Math.abs(Math.sin(time * (8 + p * 14)));
        if (q.warn <= 0) {
          if (q.kind === 'blast') {
            g.particles.burst(q.x, 0.6, q.z, q.color.clone().multiplyScalar(3), 20, q.r * 4, 0.5, 0.8, 0.8);
            g.particles.fireball(q.x, 0.6, q.z, q.r * 0.5, 12);
            g.smoke.puff(q.x, 0.6, q.z, 6, q.r * 0.6, 1.6);
            g.lighting.flash(q.x, q.z, q.color, 25, 12, 0.4);
            g.fx.ring(q.x, q.z, q.r * 1.1, q.color, 0.3, 3);
            g.fx.scorch(q.x, q.z, q.r * 0.8);
            g.audio.sfx('boom');
            g.shake = Math.max(g.shake, 0.3);
            if (!P.dead && Math.hypot(P.x - q.x, P.z - q.z) < q.r + P.r * 0.5) g.hurtPlayer(q.dmg, null);
            q.active = false;
            q.ring.visible = q.fill.visible = false;
            this.dropShell(q);
          } else {
            q.fill.scale.setScalar(q.r);
          }
        }
        continue;
      }
      // lingering pool
      q.life -= dt;
      fu.uOp.value = 0.46 + Math.sin(time * 5 + q.x) * 0.06;
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
