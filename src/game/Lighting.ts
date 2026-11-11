import * as THREE from 'three';
import type { Game } from './Game';

/**
 * Cheap "light on the ground": additive radial glow decals under every glowing thing
 * (enemies, projectiles, crystals, the player), plus a small pool of real point lights
 * for explosions. Fixed light count so materials never recompile.
 */
export class Lighting {
  pools: THREE.InstancedMesh;
  max = 1400;
  private n = 0;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  private lights: { l: THREE.PointLight; t: number; dur: number; peak: number }[] = [];

  constructor(scene: THREE.Scene, private g: Game) {
    this.scene = scene;
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const x = cv.getContext('2d')!;
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 });
    this.pools = new THREE.InstancedMesh(geo, mat, this.max);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    this.pools.renderOrder = 1;
    for (let i = 0; i < this.max; i++) this.pools.setColorAt(i, this.c.setRGB(1, 1, 1));
    scene.add(this.pools);

    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa66, 0, 18, 1.6);
      l.position.y = 2.5;
      scene.add(l);
      this.lights.push({ l, t: 0, dur: 1, peak: 0 });
    }
  }

  private scene!: THREE.Scene;
  /** Real point lights cost every lit fragment; drop them on LOW quality. */
  setLightsEnabled(on: boolean) {
    for (const s of this.lights) {
      if (on && !s.l.parent) this.scene.add(s.l);
      if (!on && s.l.parent) s.l.parent.remove(s.l);
    }
  }

  /** Briefly light the scene with a real point light (explosions, boss deaths). */
  private lastFlash = 0;
  flash(x: number, z: number, color: THREE.ColorRepresentation | THREE.Color, peak = 40, radius = 18, dur = 0.35) {
    // rate-limit small flashes so volleys don't wash the screen out
    const now = performance.now();
    if (peak < 60 && now - this.lastFlash < 90) return;
    this.lastFlash = now;
    let s = this.lights.find((q) => q.t <= 0);
    if (!s) s = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    s.l.position.set(x, 2.5, z);
    if (color instanceof THREE.Color) s.l.color.copy(color);
    else s.l.color.set(color);
    // HDR colours: normalise so the light keeps its hue instead of clipping to white
    const mx = Math.max(s.l.color.r, s.l.color.g, s.l.color.b, 1e-4);
    s.l.color.multiplyScalar(1 / mx);
    s.l.distance = radius;
    s.t = dur;
    s.dur = dur;
    s.peak = peak;
  }

  private add(x: number, z: number, size: number, r: number, gg: number, b: number) {
    if (this.n >= this.max) return;
    this.m.makeScale(size, 1, size);
    this.m.setPosition(x, 0.07, z);
    this.pools.setMatrixAt(this.n, this.m);
    this.pools.setColorAt(this.n, this.c.setRGB(r, gg, b));
    this.n++;
  }

  update(dt: number) {
    for (const s of this.lights) {
      if (s.t <= 0) {
        s.l.intensity = 0;
        continue;
      }
      s.t -= dt;
      const p = Math.max(0, s.t / s.dur);
      s.l.intensity = s.peak * 0.6 * p * p;
    }

    const g = this.g;
    this.n = 0;
    if (g.state === 'menu') {
      this.pools.count = 0;
      return;
    }
    const k = g.night ? 1.6 : 1;
    // enemies: a pool of their accent colour
    for (const e of g.enemies.list) {
      if (e.spawnT > 0.35) continue;
      this.c.setHex(e.def.color);
      const s = e.type === 'boss' ? 16 : e.r * 5.5;
      const a = (e.type === 'boss' ? 0.2 : 0.1) * k;
      this.add(e.x, e.z, s, this.c.r * a, this.c.g * a, this.c.b * a);
    }
    // player bolts and enemy shots
    for (const b of g.proj.bolts) this.add(b.x, b.z, 2.6, b.color.r * 0.05 * k, b.color.g * 0.05 * k, b.color.b * 0.05 * k);
    for (const s of g.proj.shots) this.add(s.x, s.z, 3.2 * s.size, s.color.r * 0.12 * k, s.color.g * 0.12 * k, s.color.b * 0.12 * k);
    for (const m of g.proj.missiles) this.add(m.x, m.z, 3, 0.35 * k, 0.16 * k, 0.04 * k);
    // crystals
    for (let i = 0; i < g.pickups.gems.length; i += 2) {
      const gm = g.pickups.gems[i];
      this.add(gm.x, gm.z, 1.8, 0.05 * k, 0.16 * k, 0.18 * k);
    }
    // player
    const P = g.player;
    if (!P.dead && P.root.visible) {
      this.c.setHex(P.shipDef.accent);
      this.add(P.x, P.z, 7, this.c.r * 0.2 * k, this.c.g * 0.2 * k, this.c.b * 0.2 * k);
    }
    this.pools.count = this.n;
    this.pools.instanceMatrix.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }
}
