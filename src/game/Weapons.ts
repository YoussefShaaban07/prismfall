import * as THREE from 'three';
import { addRim } from '../core/Assets';
import { rand, TAU } from '../core/util';
import { WSTATS, type WeaponId } from './data';
import type { Enemy } from './Enemies';
import type { Game } from './Game';

export class WeaponSystem {
  timers = new Map<WeaponId, number>();
  blades: THREE.Mesh[] = [];
  bladeAng = 0;
  bladePos: { x: number; z: number }[] = [];
  private novaPending: { t: number; r: number; dmg: number } | null = null;
  private lanceSweep = 0;
  private hue = 0;
  private boltColor = new THREE.Color(0.35, 0.95, 1).multiplyScalar(4);

  constructor(scene: THREE.Scene, private g: Game) {
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    geo.scale(0.45, 0.35, 1.5);
    for (let i = 0; i < 8; i++) {
      const mat = addRim(
        new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xff4fd8, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.4, flatShading: true }),
        0xffb0f0,
        1.5,
      );
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = true;
      scene.add(m);
      this.blades.push(m);
    }
  }

  reset() {
    this.timers.clear();
    this.novaPending = null;
    for (const b of this.blades) b.visible = false;
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
      if (id === 'blades') continue;
      const t = (this.timers.get(id) ?? 0.2) - dt;
      if (t <= 0) {
        const fired = this.fire(id);
        const i = this.idx(id);
        const cd = (WSTATS[id] as { cd: number[] }).cd[i] * P.cd;
        this.timers.set(id, fired ? cd : 0.12);
      } else this.timers.set(id, t);
    }
    this.updateBlades(dt);
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
            g.damage(cur, S.dmg[i] * P.dmg, 0, 0);
            g.particles.burst(cur.x, 1, cur.z, g.colors.violet, 6, 5, 0.3, 0.4);
            cur.slow = 0.6;
            cur = g.enemies.nearest(cur.x, cur.z, 8, visited);
          }
          g.fx.lightning(pts, i === 5 ? 0xd9b8ff : 0xb48bff, 0.22);
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
      if (d < r + e.r) g.damage(e, dmg, (dx / d) * knock, (dz / d) * knock);
    }
    const col = knock < 0 ? 0xc86bff : 0x7dff9b;
    g.fx.ring(P.x, P.z, r, col, 0.45, 3.5);
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
      if (perp < w + e.r) g.damage(e, dmg, dx * 4, dz * 4);
    }
    g.fx.beam(P.x, P.z, a, len, w * 1.4, evo ? 0xffc04a : 0xffe14f, 0.35);
    for (let k = 0; k < 14; k++) {
      const t = rand(0, len);
      g.particles.emit(P.x + dx * t, 1, P.z + dz * t, rand(-2, 2), rand(0, 2), rand(-2, 2), 0.4, 0.5, g.colors.yellow, 3);
    }
  }

  private updateBlades(dt: number) {
    const g = this.g;
    const P = g.player;
    const lv = P.weapons.get('blades');
    if (!lv) {
      for (const b of this.blades) b.visible = false;
      this.bladePos.length = 0;
      return;
    }
    const i = this.idx('blades');
    const S = WSTATS.blades;
    const n = S.count[i];
    const R = S.radius[i] * P.area;
    this.bladeAng += dt * S.spin[i];
    this.bladePos.length = 0;
    for (let k = 0; k < this.blades.length; k++) {
      const b = this.blades[k];
      if (k >= n) {
        b.visible = false;
        continue;
      }
      b.visible = true;
      const evo = i === 5;
      const ring = evo && k >= n / 2 ? 1 : 0;
      const per = evo ? n / 2 : n;
      const kk = evo ? k % per : k;
      const rr = ring ? R * 1.55 : R;
      const dir = ring ? -1.3 : 1;
      const a = this.bladeAng * dir + (kk / per) * TAU + ring * 0.4;
      const x = P.x + Math.sin(a) * rr;
      const z = P.z + Math.cos(a) * rr;
      b.position.set(x, 1.0 + Math.sin(this.bladeAng * 2 + k) * 0.15, z);
      b.rotation.set(0, a + Math.PI / 2 * dir, this.bladeAng * 6);
      b.scale.setScalar(evo ? 1.35 : 1);
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
          g.damage(e, S.dmg[i] * P.dmg, (kx / kd) * 5, (kz / kd) * 5);
          g.particles.burst(x, 1, z, g.colors.pink, 5, 6, 0.25, 0.4);
        }
      }
      if (Math.random() < 0.3) g.particles.emit(x, 1, z, 0, 0, 0, 0.25, 0.45, g.colors.pink, 0);
    }
  }
}
