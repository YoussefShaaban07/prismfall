import * as THREE from 'three';
import { addRim, heroMapper } from '../core/Assets';
import { rand, TAU } from '../core/util';
import { WSTATS, type WeaponId } from './data';
import type { Enemy } from './Enemies';
import type { Game } from './Game';
import { Trail } from './Trails';

let _glow: THREE.CanvasTexture | null = null;
/** soft round glow for engine sprites */
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

export class WeaponSystem {
  timers = new Map<WeaponId, number>();
  /** all orbiting blades in one instanced draw, and their motion arcs in another */
  private bladeMesh: THREE.InstancedMesh;
  private arcMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  /** unit-radius ring sector (0.9 rad) lying on XZ; uv.x runs head (1) → tail (0) */
  private arcGeo = (() => {
    const g = new THREE.RingGeometry(0.86, 1.14, 24, 1, 0, 0.9);
    g.rotateX(-Math.PI / 2);
    return g;
  })();
  private arcMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(1, 0.4, 0.9) } },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying vec3 vP;
      void main(){
        float a = atan(-vP.z, vP.x) / 0.9;           // 0 at the leading edge, 1 at the tail
        float r = length(vP.xz);
        float across = 1.0 - abs(r - 1.0) / 0.14;
        float k = pow(clamp(1.0 - a, 0.0, 1.0), 2.2) * smoothstep(0.0, 0.6, across);
        gl_FragColor = vec4(uColor * k * 1.1, 1.0);
      }`,
  });
  bladeAng = 0;
  bladePos: { x: number; z: number }[] = [];
  private novaPending: { t: number; r: number; dmg: number } | null = null;
  private lanceSweep = 0;
  private hue = 0;
  private boltColor = new THREE.Color(0.35, 0.95, 1).multiplyScalar(4);
  // wingmen fly in the player's team colour so they never read as the (magenta) swarm
  private wingColor = new THREE.Color(0.55, 0.9, 1).multiplyScalar(3.5);
  private wingC = new THREE.Color(0x8fe0ff);
  wingmen: { obj: THREE.Group; x: number; z: number; ang: number; t: number; trail: Trail }[] = [];
  private tv = new THREE.Vector3();
  mines: { x: number; z: number; t: number; arm: number; life: number; r: number; dmg: number; pull: number; obj: THREE.Group }[] = [];
  private minePool: THREE.Group[] = [];

  constructor(scene: THREE.Scene, private g: Game) {
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    geo.scale(0.45, 0.35, 1.5);
    const bladeMat = addRim(
      new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff4fd8, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.4, flatShading: true }),
      0xffb0f0,
      1.5,
    );
    this.bladeMesh = new THREE.InstancedMesh(geo, bladeMat, 8);
    this.bladeMesh.count = 0;
    this.bladeMesh.castShadow = true;
    this.bladeMesh.frustumCulled = false;
    scene.add(this.bladeMesh);
    // a motion arc sweeping behind each blade along its orbit
    this.arcMesh = new THREE.InstancedMesh(this.arcGeo, this.arcMat, 8);
    this.arcMesh.count = 0;
    this.arcMesh.renderOrder = 2;
    this.arcMesh.frustumCulled = false;
    scene.add(this.arcMesh);
    const engineMat = new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color(0.55, 0.9, 1).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const markMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.85, 1).multiplyScalar(0.9), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    const markGeo = new THREE.RingGeometry(0.75, 0.9, 3, 1, Math.PI / 2 - 0.0, TAU).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const obj = g.assets.object('craft_speederB', 1.5, heroMapper(0x8fe0ff, 1.1));
      const inner = new THREE.Group();
      obj.rotation.y = Math.PI;
      inner.add(obj);
      // engine glow and a friendly chevron on the ground under each escort
      const eng = new THREE.Sprite(engineMat);
      eng.scale.setScalar(1.3);
      eng.position.set(0, 0.05, -0.75);
      inner.add(eng);
      const mark = new THREE.Mesh(markGeo, markMat);
      mark.position.y = -1.18;
      inner.add(mark);
      inner.visible = false;
      scene.add(inner);
      const trail = new Trail(scene, 0x8fe0ff, 0.3, 20, 0.02);
      trail.visible = false;
      this.wingmen.push({ obj: inner, x: 0, z: 0, ang: 0, t: rand(0, 0.5), trail });
    }
  }

  private makeMine(): THREE.Group {
    const gr = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.45, 1),
      addRim(new THREE.MeshStandardMaterial({ color: 0x150c2a, emissive: 0x9a7bff, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6, flatShading: true }), 0xb8a0ff, 1.6),
    );
    core.position.y = 0.6;
    gr.add(core);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.45, 1).multiplyScalar(1.6), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 6, 40), ringMat);
    ring.position.y = 0.6;
    gr.add(ring);
    // the gravity well: spiral arms on the ground sized to the pull radius, tightening as it charges
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uT: { value: 0 }, uTime: { value: 0 }, uEvo: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uT; uniform float uTime; uniform float uEvo; varying vec2 vUv;
          void main(){
            vec2 p = (vUv - 0.5) * 2.0; float r = length(p); if (r > 1.0) discard;
            float a = atan(p.y, p.x);
            float spiral = 0.5 + 0.5 * sin(a * 3.0 + log(r + 0.02) * 6.0 + uTime * (5.0 + uT * 9.0));
            float arms = pow(spiral, 7.0) * smoothstep(1.0, 0.3, r) * smoothstep(0.0, 0.2, r);
            float rim = exp(-pow((r - 0.97) * 22.0, 2.0));
            float core = exp(-r * r * 30.0);
            vec3 col = mix(vec3(0.55, 0.35, 1.0), vec3(0.8, 0.45, 1.0), uEvo);
            float k = (0.16 + uT * 0.5) * (1.0 - uEvo * 0.45); // evolved mines drop in fours; keep the overlap from washing out
            gl_FragColor = vec4(col * (arms * 0.9 + rim * 0.5 + core * 1.6) * k, 1.0);
          }`,
      }),
    );
    disc.position.y = 0.06;
    disc.renderOrder = 1;
    gr.add(disc);
    gr.userData = { core, ring, disc };
    this.g.r.scene.add(gr);
    return gr;
  }

  reset() {
    for (const w of this.wingmen) { w.obj.visible = false; w.trail.visible = false; }
    for (const m of this.mines) { m.obj.visible = false; this.minePool.push(m.obj); }
    this.mines.length = 0;
    this.timers.clear();
    this.novaPending = null;
    this.bladeMesh.count = this.arcMesh.count = 0;
    this.bladePos.length = 0;
  }

  private idx(id: WeaponId) {
    const P = this.g.player;
    if (P.evolved.has(id)) return 5;
    return (P.weapons.get(id) ?? 1) - 1;
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player;
    if (P.dead) return;
    for (const [id] of P.weapons) {
      if (id === 'blades' || id === 'wingmen') continue;
      const t = (this.timers.get(id) ?? 0.2) - dt;
      if (t <= 0) {
        const fired = this.fire(id);
        const i = this.idx(id);
        const cd = (WSTATS[id] as { cd: number[] }).cd[i] * P.cd;
        this.timers.set(id, fired ? cd : 0.12);
      } else this.timers.set(id, t);
    }
    this.updateBlades(dt);
    this.updateWingmen(dt);
    this.updateMines(dt);
    if (this.novaPending) {
      this.novaPending.t -= dt;
      if (this.novaPending.t <= 0) {
        this.novaBlast(this.novaPending.r, this.novaPending.dmg, 16, true);
        this.novaPending = null;
      }
    }
  }

  private fire(id: WeaponId): boolean {
    const g = this.g;
    const P = g.player;
    const i = this.idx(id);
    switch (id) {
      case 'blaster': {
        const S = WSTATS.blaster;
        const t = g.enemies.nearest(P.x, P.z, 24);
        if (!t) return false;
        // lead the target a little
        const lead = Math.hypot(t.x - P.x, t.z - P.z) / S.speed;
        const a = Math.atan2(t.x + t.vx * lead - P.x, t.z + t.vz * lead - P.z);
        const n = S.shots[i];
        const evo = i === 5;
        for (let k = 0; k < n; k++) {
          const aa = a + (k - (n - 1) / 2) * (evo ? 0.07 : 0.13) + (evo ? rand(-0.05, 0.05) : 0);
          let col = this.boltColor;
          if (evo) {
            this.hue = (this.hue + 0.07) % 1;
            col = new THREE.Color().setHSL(this.hue, 1, 0.6).multiplyScalar(4);
          }
          g.proj.bolt(P.x + Math.sin(aa) * 0.9, P.z + Math.cos(aa) * 0.9, aa, S.speed, S.dmg[i] * P.dmg, S.pierce[i], col);
        }
        g.particles.emit(P.x + Math.sin(a) * 1.1, 1, P.z + Math.cos(a) * 1.1, Math.sin(a) * 4, 0.5, Math.cos(a) * 4, 0.12, 0.8, g.colors.cyan, 6);
        P.flashMuzzle(a, evo ? 1.3 : 1);
        // muzzle flash: a hot white core plus a short cone of sparks
        g.particles.emit(P.x + Math.sin(a) * 1.2, 1, P.z + Math.cos(a) * 1.2, 0, 0, 0, 0.06, 1.3, g.colors.white, 0);
        for (let k = 0; k < 3; k++) {
          const sa = a + rand(-0.35, 0.35), ss = rand(8, 14);
          g.particles.emit(P.x + Math.sin(a) * 1.2, 1, P.z + Math.cos(a) * 1.2, Math.sin(sa) * ss, rand(0, 1), Math.cos(sa) * ss, 0.1, 0.22, g.colors.cyan, 8);
        }
        g.audio.sfx('shoot');
        return true;
      }
      case 'arc': {
        const S = WSTATS.arc;
        const visited = new Set<Enemy>();
        let any = false;
        for (let c = 0; c < S.chains[i]; c++) {
          let cur = g.enemies.nearest(P.x, P.z, 16, visited);
          if (!cur) break;
          any = true;
          const pts = [new THREE.Vector3(P.x, 1.2, P.z)];
          for (let j = 0; j < S.jumps[i] && cur; j++) {
            visited.add(cur);
            pts.push(new THREE.Vector3(cur.x, 1.1, cur.z));
            g.damage(cur, S.dmg[i] * P.dmg, 0, 0, 'w-arc');
            g.particles.burst(cur.x, 1, cur.z, g.colors.violet, 6, 5, 0.3, 0.4);
            cur.slow = 0.6;
            cur = g.enemies.nearest(cur.x, cur.z, 8, visited);
          }
          g.fx.lightning(pts, i === 5 ? 0xd9b8ff : 0xb48bff, 0.22);
          // side forks that crackle off each hop
          for (let k = 1; k < pts.length; k++) {
            if (Math.random() < 0.6) {
              const p0 = pts[k];
              const fa = rand(0, TAU), fl = rand(1.2, 2.6);
              g.fx.lightning([p0, new THREE.Vector3(p0.x + Math.cos(fa) * fl, 0.4, p0.z + Math.sin(fa) * fl)], 0x9a7bff, 0.12);
            }
          }
        }
        if (any) g.audio.sfx('zap');
        return any;
      }
      case 'missiles': {
        const S = WSTATS.missiles;
        const t0 = g.enemies.nearest(P.x, P.z, 28);
        if (!t0) return false;
        const n = S.count[i];
        const targets: Enemy[] = [];
        const ex = new Set<Enemy>();
        for (let k = 0; k < n; k++) {
          const t = g.enemies.nearest(P.x, P.z, 28, ex);
          if (t) {
            targets.push(t);
            ex.add(t);
          }
        }
        for (let k = 0; k < n; k++) {
          const a = P.ang + Math.PI + (k - (n - 1) / 2) * 0.5 + rand(-0.15, 0.15);
          g.proj.missile(P.x, P.z, a, S.dmg[i] * P.dmg, S.blast[i] * P.area, targets[k % Math.max(1, targets.length)] ?? null);
        }
        g.audio.sfx('missile');
        return true;
      }
      case 'nova': {
        const S = WSTATS.nova;
        const r = S.radius[i] * P.area;
        const t = g.enemies.nearest(P.x, P.z, r);
        if (!t) return false;
        if (i === 5) {
          // singularity: pull inward then detonate
          this.novaBlast(r * 1.4, S.dmg[i] * 0.3 * P.dmg, -14, false);
          this.novaPending = { t: 0.4, r, dmg: S.dmg[i] * P.dmg };
        } else {
          this.novaBlast(r, S.dmg[i] * P.dmg, S.knock[i], true);
        }
        return true;
      }
      case 'mines': {
        const S = WSTATS.mines;
        const n = S.count[i];
        for (let k = 0; k < n; k++) {
          const a = P.ang + Math.PI + (k - (n - 1) / 2) * 0.9;
          const d = 1.6 + k * 0.4;
          const obj = this.minePool.pop() ?? this.makeMine();
          obj.visible = true;
          const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
          obj.position.set(x, 0, z);
          this.mines.push({ x, z, t: 0, arm: 0.45, life: 1.7, r: S.radius[i] * P.area, dmg: S.dmg[i] * P.dmg, pull: S.pull[i], obj });
        }
        return true;
      }
      case 'lance': {
        const S = WSTATS.lance;
        const t = g.enemies.nearest(P.x, P.z, 26);
        if (!t && i < 5) return false;
        const base = t ? Math.atan2(t.x - P.x, t.z - P.z) : P.ang;
        const n = S.beams[i];
        if (i === 5) this.lanceSweep += 0.5;
        const spread = i === 5 ? TAU / n : 0.32;
        for (let k = 0; k < n; k++) {
          const a = i === 5 ? base + this.lanceSweep + k * spread : base + (k - (n - 1) / 2) * spread;
          this.lanceBeam(a, S.length, S.width[i] * P.area, S.dmg[i] * P.dmg, i === 5);
        }
        if (i < 5) P.flashMuzzle(base, 1.1);
        g.audio.sfx('lance');
        g.shake = Math.max(g.shake, 0.2);
        return true;
      }
    }
    return false;
  }

  private novaBlast(r: number, dmg: number, knock: number, visual: boolean) {
    const g = this.g;
    const P = g.player;
    const hits = g.enemies.query(P.x, P.z, r + 2);
    for (const e of hits) {
      if (e.dead) continue;
      const dx = e.x - P.x, dz = e.z - P.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < r + e.r) g.damage(e, dmg, (dx / d) * knock, (dz / d) * knock, 'w-nova');
    }
    const col = knock < 0 ? 0xc86bff : 0x7dff9b;
    g.fx.ring(P.x, P.z, r, col, 0.45, 3.5);
    // evolved nova (singularity detonation) cracks the ground in a ring of scorches
    if (visual && this.idx('nova') === 5) for (let k = 0; k < 10; k++) {
      const ca = (k / 10) * TAU + rand(-0.1, 0.1);
      g.fx.scorch(P.x + Math.cos(ca) * r * 0.75, P.z + Math.sin(ca) * r * 0.75, rand(0.8, 1.4));
    }
    if (visual) g.fx.shock(P.x, P.z, r * 1.2, 0.9, 0.45);
    g.fx.ring(P.x, P.z, r * 0.7, col, 0.35, 2);
    if (visual) {
      g.particles.ring(P.x, 0.4, P.z, knock < 0 ? g.colors.violet : g.colors.green, 48, r * 3.2, 0.35, 0.6);
      g.arena.groundUniforms.uPulse.value = 1;
      g.shake = Math.max(g.shake, 0.3);
    }
    g.audio.sfx('nova');
  }

  private lanceBeam(a: number, len: number, w: number, dmg: number, evo: boolean) {
    const g = this.g;
    const P = g.player;
    const dx = Math.sin(a), dz = Math.cos(a);
    for (const e of g.enemies.list) {
      if (e.dead) continue;
      const ex = e.x - P.x, ez = e.z - P.z;
      const along = ex * dx + ez * dz;
      if (along < 0 || along > len) continue;
      const perp = Math.abs(ex * dz - ez * dx);
      if (perp < w + e.r) g.damage(e, dmg, dx * 4, dz * 4, 'w-lance');
    }
    // evolved lance: solar beams cycle through a prismatic spectrum
    const beamCol = evo ? new THREE.Color().setHSL((g.time * 0.35 + a / TAU) % 1, 1, 0.6).getHex() : 0xffe14f;
    g.fx.beam(P.x, P.z, a, len, w * 1.4, beamCol, 0.35);
    // molten scorch line along the beam path + heat shimmer at the muzzle
    if (Math.random() < 0.5) for (let t = 3; t < len; t += 6) g.fx.scorch(P.x + dx * t, P.z + dz * t, w * 1.1);
    g.fx.shock(P.x + dx * 1.5, P.z + dz * 1.5, 3, 0.5, 0.25);
    g.lighting.flash(P.x + dx * len * 0.4, P.z + dz * len * 0.4, 0xffd060, 22, len * 0.7, 0.25);
    for (let k = 0; k < 14; k++) {
      const t = rand(0, len);
      g.particles.emit(P.x + dx * t, 1, P.z + dz * t, rand(-2, 2), rand(0, 2), rand(-2, 2), 0.4, 0.5, g.colors.yellow, 3);
    }
  }

  private updateWingmen(dt: number) {
    const g = this.g;
    const P = g.player;
    const lv = P.weapons.get('wingmen');
    const i = this.idx('wingmen');
    const S = WSTATS.wingmen;
    const n = lv ? S.count[i] : 0;
    for (let k = 0; k < this.wingmen.length; k++) {
      const w = this.wingmen[k];
      if (k >= n) {
        w.obj.visible = false;
        w.trail.visible = false;
        continue;
      }
      if (!w.obj.visible) {
        w.trail.reset();
        w.trail.visible = true;
        w.obj.visible = true;
        w.x = P.x;
        w.z = P.z;
        g.particles.burst(P.x, 1, P.z, this.wingC, 14, 5, 0.4, 0.5);
      }
      // V formation behind the player
      const side = k % 2 ? 1 : -1;
      const row = Math.floor(k / 2) + 1;
      const back = -1.8 * row, lat = 2.2 * row * side;
      const ca = Math.cos(P.ang), sa = Math.sin(P.ang);
      const tx = P.x + sa * back + ca * lat;
      const tz = P.z + ca * back - sa * lat;
      const k1 = 1 - Math.exp(-6 * dt);
      w.x += (tx - w.x) * k1;
      w.z += (tz - w.z) * k1;
      w.t -= dt;
      const target = g.enemies.nearest(w.x, w.z, 20);
      let face = P.ang;
      if (target) {
        face = Math.atan2(target.x - w.x, target.z - w.z);
        if (w.t <= 0) {
          w.t = S.cd[i] * P.cd;
          for (let s = 0; s < S.shots[i]; s++) {
            const a = face + (s - (S.shots[i] - 1) / 2) * 0.1;
            g.proj.bolt(w.x + Math.sin(a) * 0.6, w.z + Math.cos(a) * 0.6, a, 28, S.dmg[i] * P.dmg, i >= 4 ? 1 : 0, this.wingColor);
          }
          // wingman muzzle flash
          g.particles.emit(w.x + Math.sin(face) * 0.8, 1.3, w.z + Math.cos(face) * 0.8, 0, 0, 0, 0.06, 0.9, g.colors.white, 0);
          g.particles.emit(w.x + Math.sin(face) * 0.8, 1.3, w.z + Math.cos(face) * 0.8, Math.sin(face) * 6, 0, Math.cos(face) * 6, 0.1, 0.5, this.wingC, 8);
        }
      }
      w.ang += Math.atan2(Math.sin(face - w.ang), Math.cos(face - w.ang)) * Math.min(1, dt * 10);
      w.obj.position.set(w.x, 1.3 + Math.sin(g.time * 3 + k) * 0.15, w.z);
      w.obj.rotation.set(0, w.ang, Math.sin(g.time * 2 + k) * 0.15);
      w.trail.update(dt, this.tv.set(w.x - Math.sin(w.ang) * 0.5, 1.3, w.z - Math.cos(w.ang) * 0.5));
    }
  }

  private updateMines(dt: number) {
    const g = this.g;
    for (let k = this.mines.length - 1; k >= 0; k--) {
      const m = this.mines[k];
      m.t += dt;
      const { core, ring, disc } = m.obj.userData as { core: THREE.Mesh; ring: THREE.Mesh; disc: THREE.Mesh };
      core.rotation.y += dt * 4;
      core.rotation.x += dt * 3;
      const prog = Math.min(1, m.t / m.life);
      const du = (disc.material as THREE.ShaderMaterial).uniforms;
      du.uT.value = m.t > m.arm ? prog : 0;
      du.uTime.value = g.time;
      du.uEvo.value = this.idx('mines') === 5 ? 1 : 0;
      disc.scale.setScalar(m.t > m.arm ? m.r * 1.25 * (1 - prog * 0.3) : m.r * 0.4 * (m.t / m.arm));
      // the core swells and flickers as it reaches critical mass
      core.scale.setScalar(1 + prog * 0.6 + (prog > 0.8 ? Math.sin(m.t * 60) * 0.12 : 0));
      ((core.material as THREE.MeshStandardMaterial).emissiveIntensity) = 0.6 + prog * 3;
      ring.rotation.x = Math.PI / 2;
      const armed = m.t > m.arm;
      ring.scale.setScalar(armed ? m.r * (1 - ((m.t * 2) % 1)) : 0.6);
      if (armed) {
        // gravity pull toward the mine
        for (const e of g.enemies.query(m.x, m.z, m.r * 1.8)) {
          if (e.dead || e.type === 'boss') continue;
          const dx = m.x - e.x, dz = m.z - e.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d < m.r * 1.8) {
            const f = m.pull * (e.type === 'brute' || e.elite ? 0.4 : 1) * dt * 8;
            e.kx += (dx / d) * f;
            e.kz += (dz / d) * f;
          }
        }
        if (Math.random() < 0.7) {
          const a = rand(0, TAU), r = m.r * rand(0.8, 1.6);
          g.particles.emit(m.x + Math.cos(a) * r, 0.5, m.z + Math.sin(a) * r, -Math.cos(a) * r * 2.5, 0.3, -Math.sin(a) * r * 2.5, 0.35, 0.4, g.colors.violet, 0);
        }
      }
      if (m.t >= m.life) {
        g.proj.explode(m.x, m.z, m.r, m.dmg, g.colors.violet, 4, false);
        m.obj.visible = false;
        this.minePool.push(m.obj);
        this.mines[k] = this.mines[this.mines.length - 1];
        this.mines.pop();
      }
    }
  }

  private updateBlades(dt: number) {
    const g = this.g;
    const P = g.player;
    const lv = P.weapons.get('blades');
    if (!lv) {
      this.bladeMesh.count = this.arcMesh.count = 0;
      this.bladePos.length = 0;
      return;
    }
    const i = this.idx('blades');
    const S = WSTATS.blades;
    const n = S.count[i];
    const R = S.radius[i] * P.area;
    this.bladeAng += dt * S.spin[i];
    this.bladePos.length = 0;
    const cnt = Math.min(n, 8);
    const d = this.dummy;
    this.bladeMesh.count = this.arcMesh.count = cnt;
    this.bladeMesh.instanceMatrix.needsUpdate = this.arcMesh.instanceMatrix.needsUpdate = true;
    for (let k = 0; k < cnt; k++) {
      const evo = i === 5;
      const ring = evo && k >= n / 2 ? 1 : 0;
      const per = evo ? n / 2 : n;
      const kk = evo ? k % per : k;
      const rr = ring ? R * 1.55 : R;
      const dir = ring ? -1.3 : 1;
      const a = this.bladeAng * dir + (kk / per) * TAU + ring * 0.4;
      const x = P.x + Math.sin(a) * rr;
      const z = P.z + Math.cos(a) * rr;
      const by = 1.0 + Math.sin(this.bladeAng * 2 + k) * 0.15;
      d.position.set(x, by, z);
      d.rotation.set(0, a + Math.PI / 2 * dir, this.bladeAng * 6);
      d.scale.setScalar(evo ? 1.35 : 1);
      d.updateMatrix();
      this.bladeMesh.setMatrixAt(k, d.matrix);
      // the ring sector starts at angle 0 on +X and grows toward -Z; rotate it so its leading edge sits on
      // the blade and the tail trails back along the direction of travel
      d.position.set(P.x, by - 0.05, P.z);
      d.rotation.set(0, a - Math.PI / 2, 0);
      d.scale.set(rr, 1, dir > 0 ? -rr : rr); // mirror so the tail always points against the spin
      d.updateMatrix();
      this.arcMesh.setMatrixAt(k, d.matrix);
      this.bladePos.push({ x, z });
      const hits = g.enemies.query(x, z, 2);
      for (const e of hits) {
        if (e.dead || e.bladeCD > 0) continue;
        const rr2 = e.r + 0.6;
        const dx = e.x - x, dz = e.z - z;
        if (dx * dx + dz * dz < rr2 * rr2) {
          e.bladeCD = 0.32;
          const kx = e.x - P.x, kz = e.z - P.z;
          const kd = Math.hypot(kx, kz) || 1;
          g.damage(e, S.dmg[i] * P.dmg, (kx / kd) * 5, (kz / kd) * 5, 'w-blades');
          g.particles.burst(x, 1, z, g.colors.pink, 5, 6, 0.25, 0.4);
        }
      }
      if (Math.random() < 0.3) g.particles.emit(x, 1, z, 0, 0, 0, 0.25, 0.45, g.colors.pink, 0);
      // evolved saw halo: blades throw a sparking rooster tail off the ground
      if (evo && Math.random() < 0.5) {
        const ta = a + Math.PI / 2 * dir;
        g.particles.emit(x, 0.3, z, Math.sin(ta) * 8 + rand(-1, 1), rand(2, 5), Math.cos(ta) * 8 + rand(-1, 1), 0.3, 0.22, g.colors.orange, 3, -16);
      }
    }
  }
}
