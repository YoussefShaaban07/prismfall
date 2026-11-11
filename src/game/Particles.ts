import * as THREE from 'three';
import { rand, TAU } from '../core/util';

/** Additive glowing point particles, fully CPU-simulated, single draw call. */
export class Particles {
  max: number;
  count = 0;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  baseSize: Float32Array;
  drag: Float32Array;
  grav: Float32Array;
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    const mk = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', mk(this.pos, 3));
    this.geo.setAttribute('color', mk(this.col, 3));
    this.geo.setAttribute('size', mk(this.size, 1));
    this.geo.setAttribute('alpha', mk(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main(){
          vC = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, size * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = smoothstep(0.5, 0.0, d);
          float a = core * core * vA;
          gl_FragColor = vec4(vC * a * 2.2, 1.0);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, c: THREE.Color, drag = 2, grav = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.baseSize[i] = size; this.size[i] = size;
    this.alpha[i] = 1;
    this.drag[i] = drag;
    this.grav[i] = grav;
  }

  burst(x: number, y: number, z: number, c: THREE.Color, n: number, speed = 8, life = 0.6, size = 0.5, up = 0.4) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU;
      const el = (Math.random() * 2 - 1) * up;
      const s = speed * (0.25 + Math.random() * 0.75);
      this.emit(x, y, z, Math.cos(a) * s, el * s + up * s * 0.4, Math.sin(a) * s, life * rand(0.5, 1), size * rand(0.6, 1.3), c, 2.6, -6);
    }
  }

  ring(x: number, y: number, z: number, c: THREE.Color, n: number, speed: number, life = 0.5, size = 0.4) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      this.emit(x, y, z, Math.cos(a) * speed, 0, Math.sin(a) * speed, life, size, c, 3, 0);
    }
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const last = --this.count;
        if (i !== last) {
          const i3 = i * 3, l3 = last * 3;
          for (let k = 0; k < 3; k++) {
            this.pos[i3 + k] = this.pos[l3 + k];
            this.vel[i3 + k] = this.vel[l3 + k];
            this.col[i3 + k] = this.col[l3 + k];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.baseSize[i] = this.baseSize[last];
          this.drag[i] = this.drag[last];
          this.grav[i] = this.grav[last];
        }
        continue;
      }
      const i3 = i * 3;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr;
      this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt;
      this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.4;
      }
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 1.8);
      this.size[i] = this.baseSize[i] * (0.35 + 0.65 * t);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const n of ['position', 'color', 'size', 'alpha']) {
      const a = this.geo.getAttribute(n) as THREE.BufferAttribute;
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
    }
  }

  clear() {
    this.count = 0;
  }
}

/** Physical debris chunks that tumble, bounce on the ground and shrink away. */
export class Debris {
  max = 500;
  mesh: THREE.InstancedMesh;
  items: { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rs: number; life: number; max: number; s: number; c: THREE.Color }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.TetrahedronGeometry(0.22);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.6, flatShading: true, emissive: 0xffffff, emissiveIntensity: 0.0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.max);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, color: THREE.Color, n: number, speed = 7, size = 1) {
    for (let k = 0; k < n; k++) {
      if (this.items.length >= this.max) this.items.shift();
      const a = Math.random() * TAU;
      const s = speed * rand(0.3, 1);
      this.items.push({
        x, y, z, vx: Math.cos(a) * s, vy: rand(3, 9), vz: Math.sin(a) * s,
        rx: rand(0, TAU), ry: rand(0, TAU), rs: rand(-12, 12), life: rand(0.9, 1.6), max: 1.6, s: size * rand(0.6, 1.4), c: color,
      });
    }
  }

  update(dt: number) {
    const it = this.items;
    for (let i = it.length - 1; i >= 0; i--) {
      const d = it[i];
      d.life -= dt;
      if (d.life <= 0) {
        it.splice(i, 1);
        continue;
      }
      d.vy -= 22 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < 0.1) {
        d.y = 0.1;
        d.vy *= -0.35;
        d.vx *= 0.6; d.vz *= 0.6;
        d.rs *= 0.6;
      }
      d.rx += d.rs * dt;
      d.ry += d.rs * 0.7 * dt;
    }
    // rebuild (colors are re-applied in order since splice shifts entries)
    for (let i = 0; i < it.length; i++) {
      const d = it[i];
      const s = d.s * Math.min(1, d.life * 1.5);
      this.e.set(d.rx, d.ry, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(d.x, d.y, d.z), this.q, this.sc.set(s, s, s));
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, d.c);
    }
    this.mesh.count = it.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.items.length = 0;
    this.mesh.count = 0;
  }
}
