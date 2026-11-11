import { t } from '../ui/i18n';
import * as THREE from 'three';
import { rand, TAU } from '../core/util';

interface Ring { mesh: THREE.Mesh; t: number; dur: number; max: number; active: boolean; y: number }
interface Bolt { line: THREE.Line; t: number; dur: number; active: boolean; pts: THREE.Vector3[] }
interface Beam { mesh: THREE.Mesh; t: number; dur: number; active: boolean; width: number }
interface Tele { mesh: THREE.Mesh; t: number; dur: number; active: boolean }
interface Decal { mesh: THREE.Mesh; t: number; dur: number; active: boolean }
interface Floater { el: HTMLDivElement; x: number; y: number; z: number; t: number; dur: number; active: boolean; vy: number }

function radialTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.55, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Short-lived visual effects: shockwaves, lightning, beams, telegraphs, scorch marks, damage numbers. */
export class Effects {
  rings: Ring[] = [];
  bolts: Bolt[] = [];
  beams: Beam[] = [];
  teles: Tele[] = [];
  decals: Decal[] = [];
  floaters: Floater[] = [];
  shocks: { x: number; z: number; t: number; dur: number; r: number; k: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.86, 1, 96);
  private beamGeo: THREE.BufferGeometry;
  private teleGeo: THREE.PlaneGeometry;
  private decalGeo = new THREE.CircleGeometry(1, 32);
  private decalTex = radialTexture('rgba(20,8,4,0.5)', 'rgba(20,8,4,0)');
  private v = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private floatRoot: HTMLElement) {
    this.ringGeo.rotateX(-Math.PI / 2);
    this.beamGeo = new THREE.BoxGeometry(1, 1, 1);
    this.beamGeo.translate(0, 0, 0.5);
    this.teleGeo = new THREE.PlaneGeometry(1, 1);
    this.teleGeo.rotateX(-Math.PI / 2);
    this.teleGeo.translate(0, 0, 0.5);
    this.decalGeo.rotateX(-Math.PI / 2);
  }

  ring(x: number, z: number, maxR: number, color: THREE.ColorRepresentation, dur = 0.45, intensity = 3, y = 0.15) {
    let r = this.rings.find((q) => !q.active);
    if (!r) {
      if (this.rings.length > 40) return;
      const mesh = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.renderOrder = 4;
      this.scene.add(mesh);
      r = { mesh, t: 0, dur, max: maxR, active: false, y };
      this.rings.push(r);
    }
    const m = r.mesh.material as THREE.MeshBasicMaterial;
    m.color.set(color).multiplyScalar(intensity * 0.55);
    r.mesh.position.set(x, y, z);
    r.mesh.visible = true;
    r.t = 0;
    r.dur = dur;
    r.max = maxR;
    r.y = y;
    r.active = true;
  }

  lightning(points: THREE.Vector3[], color: THREE.ColorRepresentation, dur = 0.2) {
    let b = this.bolts.find((q) => !q.active);
    if (!b) {
      if (this.bolts.length > 30) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3 * 2), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.frustumCulled = false;
      line.renderOrder = 6;
      this.scene.add(line);
      b = { line, t: 0, dur, active: false, pts: [] };
      this.bolts.push(b);
    }
    (b.line.material as THREE.LineBasicMaterial).color.set(color).multiplyScalar(6);
    b.pts = points.map((p) => p.clone());
    b.t = 0;
    b.dur = dur;
    b.active = true;
    b.line.visible = true;
    this.jag(b);
  }

  private jag(b: Bolt) {
    const attr = b.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let n = 0;
    for (let i = 0; i < b.pts.length - 1 && n < 60; i++) {
      const a = b.pts[i], c = b.pts[i + 1];
      const segs = 5;
      for (let s = 0; s <= segs; s++) {
        if (i > 0 && s === 0) continue;
        const t = s / segs;
        const j = s === 0 || s === segs ? 0 : 0.55;
        arr[n * 3] = a.x + (c.x - a.x) * t + rand(-j, j);
        arr[n * 3 + 1] = a.y + (c.y - a.y) * t + rand(-j, j) * 0.6;
        arr[n * 3 + 2] = a.z + (c.z - a.z) * t + rand(-j, j);
        n++;
      }
    }
    attr.needsUpdate = true;
    b.line.geometry.setDrawRange(0, n);
  }

  beam(x: number, z: number, angle: number, length: number, width: number, color: THREE.ColorRepresentation, dur = 0.32) {
    let b = this.beams.find((q) => !q.active);
    if (!b) {
      const mesh = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      b = { mesh, t: 0, dur, active: false, width };
      this.beams.push(b);
    }
    (b.mesh.material as THREE.MeshBasicMaterial).color.set(color).multiplyScalar(5);
    b.mesh.position.set(x, 1.0, z);
    b.mesh.rotation.set(0, angle, 0);
    b.mesh.scale.set(width, width * 0.6, length);
    b.width = width;
    b.t = 0;
    b.dur = dur;
    b.active = true;
    b.mesh.visible = true;
  }

  telegraph(x: number, z: number, angle: number, length: number, width: number, dur: number) {
    let t = this.teles.find((q) => !q.active);
    if (!t) {
      const mesh = new THREE.Mesh(
        this.teleGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.15, 0.25).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      t = { mesh, t: 0, dur, active: false };
      this.teles.push(t);
    }
    t.mesh.position.set(x, 0.12, z);
    t.mesh.rotation.set(0, angle, 0);
    t.mesh.scale.set(width, 1, length);
    t.t = 0;
    t.dur = dur;
    t.active = true;
    t.mesh.visible = true;
    return t;
  }

  scorch(x: number, z: number, r: number) {
    let d = this.decals.find((q) => !q.active);
    if (!d) {
      if (this.decals.length > 30) {
        d = this.decals.reduce((a, b) => (a.t > b.t ? a : b));
      } else {
        const mesh = new THREE.Mesh(
          this.decalGeo,
          new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
        );
        mesh.renderOrder = 1;
        this.scene.add(mesh);
        d = { mesh, t: 0, dur: 8, active: false };
        this.decals.push(d);
      }
    }
    d.mesh.position.set(x, 0.03, z);
    d.mesh.rotation.y = rand(0, TAU);
    d.mesh.scale.setScalar(r);
    d.t = 0;
    d.dur = 8;
    d.active = true;
    d.mesh.visible = true;
  }

  /** Screen-space heat ripple expanding from a world point. */
  shock(x: number, z: number, r: number, strength = 1, dur = 0.5) {
    if (this.shocks.length >= 8) this.shocks.shift();
    this.shocks.push({ x, z, t: 0, dur, r, k: strength });
  }

  /** Project active shockwaves into the distortion pass uniforms. */
  writeShocks(dt: number, waves: THREE.Vector4[], aspect: number) {
    const v = this.v;
    const v2 = new THREE.Vector3();
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      this.shocks[i].t += dt;
      if (this.shocks[i].t >= this.shocks[i].dur) this.shocks.splice(i, 1);
    }
    for (let i = 0; i < 8; i++) {
      const s = this.shocks[i];
      if (!s) { waves[i].set(0, 0, 0, 0); continue; }
      const p = s.t / s.dur;
      const e = 1 - Math.pow(1 - p, 2.5);
      v.set(s.x, 0.5, s.z).project(this.camera);
      v2.set(s.x + s.r * e, 0.5, s.z).project(this.camera);
      const cx = v.x * 0.5 + 0.5, cy = v.y * 0.5 + 0.5;
      const rx = (v2.x * 0.5 + 0.5 - cx) * aspect, ry = v2.y * 0.5 + 0.5 - cy;
      waves[i].set(cx, cy, Math.hypot(rx, ry), s.k * (1 - p));
    }
  }

  text(x: number, y: number, z: number, txt: string, cls = '') {
    let f = this.floaters.find((q) => !q.active);
    if (!f) {
      if (this.floaters.length >= 60) return;
      const el = document.createElement('div');
      el.className = 'floater';
      this.floatRoot.appendChild(el);
      f = { el, x, y, z, t: 0, dur: 0.8, active: false, vy: 0 };
      this.floaters.push(f);
    }
    f.el.textContent = t(txt);
    f.el.className = 'floater ' + cls;
    f.x = x + rand(-0.3, 0.3);
    f.y = y;
    f.z = z + rand(-0.3, 0.3);
    f.t = 0;
    f.dur = cls.includes('big') ? 1.2 : 0.75;
    f.vy = 2.2;
    f.active = true;
    f.el.style.display = 'block';
  }

  update(dt: number, w: number, h: number) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const p = r.t / r.dur;
      if (p >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - p, 3);
      r.mesh.scale.setScalar(0.2 + e * r.max);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }
    for (const b of this.bolts) {
      if (!b.active) continue;
      b.t += dt;
      if (b.t >= b.dur) {
        b.active = false;
        b.line.visible = false;
        continue;
      }
      if (Math.random() < 0.5) this.jag(b);
      (b.line.material as THREE.LineBasicMaterial).opacity = 1 - b.t / b.dur;
    }
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t += dt;
      const p = b.t / b.dur;
      if (p >= 1) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const w2 = b.width * (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85);
      b.mesh.scale.x = w2;
      b.mesh.scale.y = w2 * 0.6;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p * p;
    }
    for (const t of this.teles) {
      if (!t.active) continue;
      t.t += dt;
      if (t.t >= t.dur) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.35 * Math.abs(Math.sin(t.t * 18));
    }
    for (const d of this.decals) {
      if (!d.active) continue;
      d.t += dt;
      if (d.t >= d.dur) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, (d.dur - d.t) / 2);
    }
    for (const f of this.floaters) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      f.y += f.vy * dt;
      f.vy *= Math.exp(-3 * dt);
      this.v.set(f.x, f.y, f.z).project(this.camera);
      if (this.v.z > 1) {
        f.el.style.display = 'none';
        continue;
      }
      const sx = (this.v.x * 0.5 + 0.5) * w;
      const sy = (-this.v.y * 0.5 + 0.5) * h;
      const p = f.t / f.dur;
      const sc = p < 0.15 ? 0.6 + (p / 0.15) * 0.6 : 1.2 - Math.min(0.2, (p - 0.15) * 0.5);
      f.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${sc})`;
      f.el.style.opacity = String(p > 0.6 ? 1 - (p - 0.6) / 0.4 : 1);
    }
  }

  clear() {
    for (const r of this.rings) { r.active = false; r.mesh.visible = false; }
    for (const b of this.bolts) { b.active = false; b.line.visible = false; }
    for (const b of this.beams) { b.active = false; b.mesh.visible = false; }
    for (const t of this.teles) { t.active = false; t.mesh.visible = false; }
    for (const d of this.decals) { d.active = false; d.mesh.visible = false; }
    for (const f of this.floaters) { f.active = false; f.el.style.display = 'none'; }
    this.shocks.length = 0;
  }
}
