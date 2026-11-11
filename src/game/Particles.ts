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
  kind: Uint8Array;
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
    this.kind = new Uint8Array(max);
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
    this.kind[i] = 0;
  }

  /** Billowing fireball: white-hot core cooling to orange and deep red. */
  fireball(x: number, y: number, z: number, radius: number, n = 14) {
    for (let k = 0; k < n; k++) {
      if (this.count >= this.max) return;
      const a = Math.random() * TAU, el = Math.random() * 0.8;
      const sp = radius * rand(1.2, 3.2);
      this.emit(x, y + rand(0, 0.4), z, Math.cos(a) * sp * (1 - el), sp * el * 0.8 + 1, Math.sin(a) * sp * (1 - el), rand(0.3, 0.6), radius * rand(0.6, 1.2), this.tmpC, 4, 1.5);
      this.kind[this.count - 1] = 1;
    }
  }
  private tmpC = new THREE.Color();

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
          this.kind[i] = this.kind[last];
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
      if (this.kind[i] === 1) {
        // fire: grows then fades, colour cools over life
        const h = t;
        const r = 2.4 * (0.55 + 0.45 * h), gg = 2.4 * Math.max(0.1, h * h * 0.75), b = 2.4 * Math.max(0.015, h * h * h * 0.35);
        this.col[i3] = r; this.col[i3 + 1] = gg; this.col[i3 + 2] = b;
        this.alpha[i] = Math.min(1, t * 2.5) * 0.7;
        this.size[i] = this.baseSize[i] * (1.15 - t * 0.55);
      } else {
        this.alpha[i] = Math.min(1, t * 1.8);
        this.size[i] = this.baseSize[i] * (0.35 + 0.65 * t);
      }
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


/** Soft, non-additive smoke puffs that billow, rise and fade. */
export class Smoke {
  max = 1400;
  count = 0;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  base: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  seed: Float32Array;
  shade: Float32Array;
  geo = new THREE.BufferGeometry();
  mat: THREE.ShaderMaterial;
  points: THREE.Points;
  wind = 0.6;

  constructor(scene: THREE.Scene) {
    const m = this.max;
    this.pos = new Float32Array(m * 3);
    this.vel = new Float32Array(m * 3);
    this.life = new Float32Array(m);
    this.maxLife = new Float32Array(m);
    this.base = new Float32Array(m);
    this.size = new Float32Array(m);
    this.alpha = new Float32Array(m);
    this.seed = new Float32Array(m);
    this.shade = new Float32Array(m);
    const mk = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', mk(this.pos, 3));
    this.geo.setAttribute('size', mk(this.size, 1));
    this.geo.setAttribute('alpha', mk(this.alpha, 1));
    this.geo.setAttribute('seed', mk(this.seed, 1));
    this.geo.setAttribute('shade', mk(this.shade, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uTint: { value: new THREE.Color(0.32, 0.24, 0.22) }, uLight: { value: new THREE.Color(1.0, 0.75, 0.55) } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute float seed; attribute float shade;
        varying float vA; varying float vS; varying float vSh; uniform float uScale;
        void main(){
          vA = alpha; vS = seed; vSh = shade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, size * uScale / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vS; varying float vSh; uniform vec3 uTint; uniform vec3 uLight;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float a0 = vS * 6.2831;
          c = mat2(cos(a0), -sin(a0), sin(a0), cos(a0)) * c;
          float d = length(c);
          float n = n2(c * 5.0 + vS * 17.0) * 0.6 + n2(c * 11.0 - vS * 9.0) * 0.4;
          float a = smoothstep(0.5, 0.1, d + (n - 0.5) * 0.35) * vA;
          if (a < 0.01) discard;
          // fake top-lighting: brighter on the upper half of the puff
          float lit = clamp(0.5 - c.y * 1.2, 0.0, 1.0);
          vec3 col = mix(uTint * 0.55, uTint + uLight * 0.18, lit) * vSh;
          gl_FragColor = vec4(col, a * 0.75);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  puff(x: number, y: number, z: number, n: number, radius = 1, life = 1.4, shade = 1) {
    for (let k = 0; k < n; k++) {
      if (this.count >= this.max) return;
      const i = this.count++;
      const i3 = i * 3;
      const a = Math.random() * TAU, r = Math.random() * radius * 0.6;
      this.pos[i3] = x + Math.cos(a) * r; this.pos[i3 + 1] = y + Math.random() * 0.5; this.pos[i3 + 2] = z + Math.sin(a) * r;
      const sp = radius * rand(0.6, 2.2);
      this.vel[i3] = Math.cos(a) * sp; this.vel[i3 + 1] = rand(0.8, 2.4); this.vel[i3 + 2] = Math.sin(a) * sp;
      this.life[i] = this.maxLife[i] = life * rand(0.7, 1.3);
      this.base[i] = radius * rand(1.4, 2.6);
      this.seed[i] = Math.random();
      this.shade[i] = shade * rand(0.75, 1.15);
    }
  }

  trail(x: number, y: number, z: number, size = 0.6, life = 0.9) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = rand(-0.3, 0.3); this.vel[i3 + 1] = rand(0.3, 0.8); this.vel[i3 + 2] = rand(-0.3, 0.3);
    this.life[i] = this.maxLife[i] = life;
    this.base[i] = size;
    this.seed[i] = Math.random();
    this.shade[i] = rand(0.9, 1.3);
  }

  update(dt: number) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          const i3 = i * 3, l3 = last * 3;
          for (let k = 0; k < 3; k++) { this.pos[i3 + k] = this.pos[l3 + k]; this.vel[i3 + k] = this.vel[l3 + k]; }
          this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last]; this.base[i] = this.base[last];
          this.seed[i] = this.seed[last]; this.shade[i] = this.shade[last];
        }
        continue;
      }
      const i3 = i * 3;
      const dr = Math.exp(-2.2 * dt);
      this.vel[i3] *= dr; this.vel[i3 + 2] *= dr; this.vel[i3 + 1] *= Math.exp(-0.8 * dt);
      this.pos[i3] += this.vel[i3] * dt + dt * this.wind; // wind
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.base[i] * (0.5 + t * 1.6);
      this.alpha[i] = Math.min(1, t * 6) * (1 - t) * (1 - t);
      this.seed[i] += dt * 0.05;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    for (const n of ['position', 'size', 'alpha', 'seed', 'shade']) {
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
