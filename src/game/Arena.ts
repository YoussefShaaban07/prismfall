import * as THREE from 'three';
import type { Assets, ModelName } from '../core/Assets';
import { heroMapper } from '../core/Assets';
import { ARENA_RADIUS } from './data';
import { rand, TAU } from '../core/util';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

function flareTex(kind: 'core' | 'ring' | 'hex'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'core') {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,245,230,1)');
    gr.addColorStop(0.15, 'rgba(255,200,150,0.8)');
    gr.addColorStop(0.5, 'rgba(255,120,60,0.15)');
    gr.addColorStop(1, 'rgba(255,100,40,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  } else if (kind === 'ring') {
    const gr = g.createRadialGradient(64, 64, 40, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.7, 'rgba(255,200,170,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56);
    }
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Merge every static mesh under root into one mesh per distinct material (huge draw-call saving). */
function bakeStatic(root: THREE.Object3D, castShadow: boolean): THREE.Group {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; recv: boolean }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    const key = [mat.name, mat.color?.getHexString(), mat.emissive?.getHexString(), mat.emissiveIntensity, mat.metalness, mat.roughness, m.castShadow].join('|');
    if (!buckets.has(key)) buckets.set(key, { mat, geos: [], recv: m.receiveShadow });
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    buckets.get(key)!.geos.push(g);
  });
  const out = new THREE.Group();
  for (const { mat, geos, recv } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = recv;
    out.add(mesh);
  }
  return out;
}

/* ---------- tileable value noise for the procedural Mars ground ---------- */
function makeGroundTexture(size = 512): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const lattice = (n: number) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
  };
  const octs = [4, 8, 16, 32, 64].map((n) => ({ n, a: lattice(n) }));
  const sm = (t: number) => t * t * (3 - 2 * t);
  const sample = (o: { n: number; a: Float32Array }, u: number, v: number) => {
    const x = u * o.n, y = v * o.n;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const i = (xx: number, yy: number) => o.a[((yy % o.n) + o.n) % o.n * o.n + (((xx % o.n) + o.n) % o.n)];
    const a = i(x0, y0), b = i(x0 + 1, y0), cc = i(x0, y0 + 1), d = i(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = 0, amp = 0.5, tot = 0;
      for (const o of octs) {
        n += sample(o, u, v) * amp;
        tot += amp;
        amp *= 0.55;
      }
      n /= tot;
      const ridge = 1 - Math.abs(sample(octs[2], u * 1, v * 1) * 2 - 1);
      const t = Math.min(1, Math.max(0, n * 1.25 - 0.12));
      // dusty rust palette
      let r = 70 + t * 120 + ridge * 18;
      let gg = 32 + t * 58 + ridge * 8;
      let b = 26 + t * 36;
      const speck = Math.random();
      if (speck > 0.985) { r *= 0.6; gg *= 0.6; b *= 0.6; }
      if (speck < 0.01) { r *= 1.25; gg *= 1.2; b *= 1.15; }
      const k = (y * size + x) * 4;
      img.data[k] = Math.min(255, r);
      img.data[k + 1] = Math.min(255, gg);
      img.data[k + 2] = Math.min(255, b);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- terrain height: flat arena, dunes outside, ridged mountains on the horizon ---------- */
function vhash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = vhash(xi, zi), b = vhash(xi + 1, zi), c = vhash(xi, zi + 1), d = vhash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, z * f) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}
function ridged(x: number, z: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f, z * f) * 2 - 1);
    s += n * n * amp;
    f *= 2.1;
    amp *= 0.5;
  }
  return s;
}
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function terrainHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const R = ARENA_RADIUS;
  if (r < R + 26) return 0;
  const dunes = sstep(R + 26, R + 60, r) * (fbm(x * 0.025, z * 0.025, 4) - 0.35) * 9;
  const mesas = sstep(R + 50, R + 110, r) * Math.pow(fbm(x * 0.012 + 7, z * 0.012 - 3, 4), 3) * 38;
  const mountains = sstep(230, 370, r) * ridged(x * 0.005 + 3, z * 0.005 + 11, 5) * 75;
  return Math.max(0, dunes) + mesas + mountains;
}

export class Arena {
  group = new THREE.Group();
  groundUniforms = {
    uPlayer: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uRadius: { value: ARENA_RADIUS },
    uPulse: { value: 0 },
    uDanger: { value: 0 },
    uNight: { value: 0 },
  };
  wallMat: THREE.ShaderMaterial;
  skyMat: THREE.ShaderMaterial;
  dust: THREE.Points;
  beacons: THREE.Mesh[] = [];
  spinners: THREE.Object3D[] = [];
  flare: Lensflare;
  sunHolder = new THREE.Object3D();

  constructor(scene: THREE.Scene, assets: Assets) {
    scene.add(this.group);
    const statics = new THREE.Group();
    const R = ARENA_RADIUS;

    /* ----- ground ----- */
    const gtex = makeGroundTexture(1024);
    gtex.repeat.set(26, 26);
    const groundMat = new THREE.MeshStandardMaterial({
      map: gtex,
      roughness: 0.92,
      metalness: 0.05,
      normalMap: assets.groundNormal ?? undefined,
      normalScale: new THREE.Vector2(0.9, 0.9),
    });
    if (assets.groundNormal) assets.groundNormal.repeat.set(40, 40);
    const U = this.groundUniforms;
    groundMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; uniform vec2 uPlayer; uniform float uTime; uniform float uRadius; uniform float uPulse; uniform float uDanger; uniform float uNight;
          float gridLine(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }`)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec4 texA = texture2D(map, vMapUv);
            vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.173 + 0.37;
            vec4 texB = texture2D(map, uv2);
            float mixK = smoothstep(0.35, 0.65, texture2D(map, vMapUv * 0.031).r);
            vec4 sampledDiffuseColor = mix(texA, texB, 0.35 + mixK * 0.3);
            diffuseColor *= sampledDiffuseColor;
          #endif
          {
            // height and slope tint: dusty crests, darker rock in the gullies
            float hgt = vWPos.y;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(1.25, 1.12, 1.0), smoothstep(10.0, 80.0, hgt));
            diffuseColor.rgb *= mix(0.82, 1.0, smoothstep(0.0, 3.0, hgt) * 0.5 + 0.5);
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec2 p = vWPos.xz;
            float r = length(p);
            float inside = 1.0 - smoothstep(uRadius - 0.5, uRadius + 0.5, r);
            float dp = length(p - uPlayer);
            float near = exp(-dp * 0.12);
            float minor = gridLine(p, 3.0);
            float major = gridLine(p, 15.0);
            float ring = exp(-pow((r - mod(uTime * 9.0, uRadius * 1.6)) * 0.35, 2.0)) * 0.6;
            float edge = exp(-abs(r - uRadius) * 1.4);
            vec3 cyan = vec3(0.25, 0.85, 1.0);
            vec3 mag = vec3(1.0, 0.25, 0.75);
            vec3 gridCol = mix(cyan, mag, uDanger);
            vec3 em = gridCol * (minor * (0.015 + near * 0.22) + major * (0.06 + near * 0.4)) * inside * (1.0 + uNight * 1.2);
            em += gridCol * ring * (minor + major) * inside * (0.25 + uPulse);
            em += mix(vec3(1.0, 0.35, 0.8), vec3(0.3, 0.9, 1.0), 0.5 + 0.5 * sin(atan(p.y, p.x) * 6.0 + uTime)) * edge * 1.6;
            em += cyan * near * 0.05;
            totalEmissiveRadiance += em;
            diffuseColor.rgb *= mix(0.55, 1.0, inside);
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.66, 0.9), uNight);
          }`);
    };
    const tg = new THREE.PlaneGeometry(800, 800, 300, 300);
    tg.rotateX(-Math.PI / 2);
    const tp = tg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setY(i, terrainHeight(tp.getX(i), tp.getZ(i)));
    tg.computeVertexNormals();
    const ground = new THREE.Mesh(tg, groundMat);
    ground.receiveShadow = true;
    this.group.add(ground);

    /* ----- force-field wall ----- */
    this.wallMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector2() }, uDanger: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW; uniform float uTime; uniform vec2 uPlayer; uniform float uDanger;
        float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
        void main(){
          float h = vUv.y;
          float fade = pow(1.0 - h, 2.2);
          float hx = smoothstep(0.0, 0.08, hex(vec2(vUv.x * 160.0, vUv.y * 6.0 - uTime * 0.6)));
          float lines = 1.0 - hx;
          float scan = smoothstep(0.96, 1.0, sin(vUv.y * 40.0 - uTime * 6.0));
          float d = length(vW.xz - uPlayer);
          float prox = exp(-d * 0.15) * 0.7;
          vec3 col = mix(vec3(0.15, 0.75, 1.0), vec3(1.0, 0.3, 0.75), 0.5 + 0.5 * sin(vUv.x * 6.2831 * 3.0 + uTime * 0.7));
          col = mix(col, vec3(1.0, 0.2, 0.3), uDanger * 0.6);
          float a = fade * (0.12 + lines * (0.35 + prox) + scan * 0.25) + exp(-h * 18.0) * 1.2;
          gl_FragColor = vec4(col * a, 1.0);
        }`,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 7, 160, 1, true), this.wallMat);
    wall.position.y = 3.5;
    wall.renderOrder = 2;
    this.group.add(wall);

    /* ----- emitter pylons around the wall ----- */
    const pylonMapper = heroMapper(0x5ef2ff, 0.7);
    const beaconGeo = new THREE.OctahedronGeometry(0.45);
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7ff6ff).multiplyScalar(2.2) });
    const pylonCount = 28;
    for (let i = 0; i < pylonCount; i++) {
      const a = (i / pylonCount) * TAU;
      const p = assets.object('supports_high', 1.6, pylonMapper);
      p.position.set(Math.cos(a) * (R + 0.9), 0, Math.sin(a) * (R + 0.9));
      p.rotation.y = -a;
      statics.add(p);
      const b = new THREE.Mesh(beaconGeo, beaconMat);
      b.position.set(p.position.x, (p.userData.height as number) + 0.7, p.position.z);
      this.group.add(b);
      this.beacons.push(b);
    }

    /* ----- colony base outside the arena ----- */
    const base = heroMapper(0xff8a2a, 1.3);
    const place = (name: ModelName, size: number, r: number, a: number, rotJitter = true) => {
      const o = assets.object(name, size, base);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      o.position.y = terrainHeight(o.position.x, o.position.z);
      o.rotation.y = rotJitter ? rand(0, TAU) : -a + Math.PI / 2;
      statics.add(o);
      return o;
    };
    const structures: [ModelName, number][] = [
      ['hangar_roundA', 9], ['hangar_roundB', 9], ['hangar_roundGlass', 9], ['hangar_largeA', 8], ['hangar_smallA', 6],
      ['satelliteDish_large', 7], ['satelliteDish_detailed', 5], ['machine_generatorLarge', 4.5], ['machine_wireless', 4],
      ['turret_double', 4], ['structure_detailed', 5], ['gate_complex', 6], ['barrels', 3], ['rover', 3], ['platform_large', 7],
    ];
    let ang = 0;
    while (ang < TAU - 0.12) {
      const [name, size] = structures[Math.floor(Math.random() * structures.length)];
      const r = R + rand(9, 22);
      place(name, size * rand(0.85, 1.15), r, ang, name !== 'gate_complex');
      if (Math.random() < 0.55) place('rock_largeA', rand(3, 6), R + rand(5, 30), ang + rand(-0.06, 0.06));
      ang += rand(0.2, 0.36);
    }
    // rockets on launch pads
    for (const a of [0.6, 2.4, 4.1, 5.5]) {
      const r = R + 26;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const k = 5;
      let y = 0;
      const stack: [ModelName, number][] = [['rocket_baseA', 1.8], ['rocket_fuelA', 1], ['rocket_sidesA', 1], ['rocket_sidesA', 1], ['rocket_topA', 1]];
      const pad = assets.object('platform_large', 12, base);
      pad.position.set(x, 0, z);
      statics.add(pad);
      for (const [n, w] of stack) {
        const o = assets.object(n, w * k, base);
        o.position.set(x, y + 0.2, z);
        statics.add(o);
        y += o.userData.height as number;
      }
    }
    // outer ring of large rocks and crystals
    for (let i = 0; i < 70; i++) {
      const a = rand(0, TAU);
      const r = R + rand(32, 90);
      const name: ModelName = Math.random() < 0.25 ? 'rock_crystalsLargeA' : Math.random() < 0.5 ? 'rock_largeB' : 'rock_largeA';
      const o = assets.object(name, rand(5, 14), base);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      o.position.y = terrainHeight(o.position.x, o.position.z) - 0.6;
      o.rotation.y = rand(0, TAU);
      statics.add(o);
    }
    // craters and pebbles inside the arena (purely decorative, low)
    for (let i = 0; i < 0; i++) {
      const a = rand(0, TAU);
      const r = Math.sqrt(Math.random()) * (R - 6);
      const o = assets.object(Math.random() < 0.5 ? 'craterLarge' : 'crater', rand(3, 6), base, false);
      o.scale.y = 0.35;
      o.position.set(Math.cos(a) * r, -0.05, Math.sin(a) * r);
      o.rotation.y = rand(0, TAU);
      o.traverse((m) => ((m as THREE.Mesh).receiveShadow = true));
      statics.add(o);
    }
    for (let i = 0; i < 90; i++) {
      const a = rand(0, TAU);
      const r = Math.sqrt(Math.random()) * (R - 2);
      const names: ModelName[] = ['rocks_smallA', 'rocks_smallB', 'rock_crystals'];
      const o = assets.object(names[Math.floor(Math.random() * 3)], rand(0.8, 2), base);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      o.rotation.y = rand(0, TAU);
      statics.add(o);
    }
    this.group.add(bakeStatic(statics, true));

    /* ----- sky dome ----- */
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir; uniform float uTime; uniform float uNight;
        float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
        float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
        float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += n2(p) * a; p = p * 2.03 + 1.7; a *= 0.5; } return s; }
        void main(){
          float y = vDir.y;
          vec3 horizon = mix(vec3(0.42, 0.17, 0.12), vec3(0.06, 0.08, 0.16), uNight);
          vec3 mid = mix(vec3(0.14, 0.05, 0.12), vec3(0.03, 0.03, 0.08), uNight);
          vec3 zenith = mix(vec3(0.015, 0.01, 0.04), vec3(0.004, 0.004, 0.015), uNight);
          vec3 col = mix(horizon, mid, smoothstep(-0.02, 0.18, y));
          col = mix(col, zenith, smoothstep(0.15, 0.7, y));
          // sun glow
          vec3 sd = normalize(vec3(-0.55, 0.18, 0.35));
          float s = max(dot(vDir, sd), 0.0);
          col += (vec3(1.0, 0.55, 0.3) * pow(s, 64.0) * 2.5 + vec3(0.6, 0.25, 0.15) * pow(s, 6.0) * 0.5) * (1.0 - uNight);
          vec3 md = normalize(vec3(0.4, 0.45, -0.6));
          float mo = max(dot(vDir, md), 0.0);
          col += (vec3(0.8, 0.9, 1.0) * smoothstep(0.9993, 0.9996, mo) * 2.0 + vec3(0.2, 0.3, 0.6) * pow(mo, 30.0) * 0.4) * uNight;
          // aurora ribbons on night maps
          float au = sin(vDir.x * 9.0 + uTime * 0.25 + sin(vDir.z * 7.0 + uTime * 0.1) * 1.5) * 0.5 + 0.5;
          col += vec3(0.1, 0.9, 0.6) * pow(au, 6.0) * smoothstep(0.15, 0.4, y) * smoothstep(0.85, 0.45, y) * 0.25 * uNight;
          // high-altitude dust clouds, lit from the sun side
          if (y > 0.0) {
            vec2 cp = vDir.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
            float cl = fbm2(cp);
            cl = smoothstep(0.48, 0.85, cl) * smoothstep(0.0, 0.12, y) * smoothstep(0.75, 0.25, y);
            float sunSide = pow(max(dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sd.x, 0.0, sd.z))), 0.0), 2.0);
            vec3 cloudCol = mix(vec3(0.38, 0.17, 0.16), vec3(1.0, 0.55, 0.32), sunSide * (1.0 - uNight));
            cloudCol = mix(cloudCol, vec3(0.08, 0.1, 0.18), uNight);
            col = mix(col, cloudCol, cl * 0.7);
          }
          // stars
          vec3 q = floor(vDir * 420.0);
          float st = step(0.9965 - uNight * 0.002, h(q)) * smoothstep(0.08, 0.5, y);
          col += vec3(st) * (0.6 + 0.4 * sin(uTime * 3.0 + h(q) * 50.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.skyMat);
    this.group.add(sky);

    // twin moons (Phobos and Deimos)
    const moonMat = new THREE.MeshStandardMaterial({ color: 0x8a7a70, roughness: 1, emissive: 0x2a1a14, emissiveIntensity: 0.6, flatShading: true });
    const m1 = new THREE.Mesh(new THREE.IcosahedronGeometry(18, 2), moonMat);
    m1.position.set(120, 110, -260);
    m1.scale.set(1, 0.8, 0.9);
    this.group.add(m1);
    const m2 = new THREE.Mesh(new THREE.IcosahedronGeometry(7, 1), moonMat);
    m2.position.set(-170, 150, -230);
    this.group.add(m2);
    this.spinners.push(m1, m2);

    /* ----- sun lens flare ----- */
    this.flare = new Lensflare();
    const core = flareTex('core'), ring = flareTex('ring'), hex = flareTex('hex');
    this.flare.addElement(new LensflareElement(core, 420, 0, new THREE.Color(1, 0.85, 0.7)));
    this.flare.addElement(new LensflareElement(ring, 220, 0.25, new THREE.Color(1, 0.6, 0.4)));
    this.flare.addElement(new LensflareElement(hex, 60, 0.45, new THREE.Color(0.8, 0.6, 1)));
    this.flare.addElement(new LensflareElement(hex, 90, 0.62, new THREE.Color(0.5, 0.9, 1)));
    this.flare.addElement(new LensflareElement(ring, 160, 0.85, new THREE.Color(1, 0.7, 0.5)));
    this.sunHolder.add(this.flare);
    this.group.add(this.sunHolder);

    /* ----- drifting dust ----- */
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-90, 90);
      pos[i * 3 + 1] = rand(0.3, 16);
      pos[i * 3 + 2] = rand(-90, 90);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({ color: 0xffb08a, size: 0.12, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /** Keep the flare source on the sun direction, far from the camera. */
  placeSun(cam: THREE.Camera, night: boolean) {
    const d = night ? new THREE.Vector3(0.4, 0.45, -0.6) : new THREE.Vector3(-0.55, 0.18, 0.35);
    d.normalize().multiplyScalar(850);
    this.sunHolder.position.copy(cam.position).add(d);
  }

  update(dt: number, time: number, px: number, pz: number, danger: number) {
    const U = this.groundUniforms;
    U.uTime.value = time;
    U.uPlayer.value.set(px, pz);
    U.uPulse.value = Math.max(0, U.uPulse.value - dt * 1.5);
    U.uDanger.value += (danger - U.uDanger.value) * Math.min(1, dt * 2);
    this.wallMat.uniforms.uTime.value = time;
    this.wallMat.uniforms.uPlayer.value.set(px, pz);
    this.wallMat.uniforms.uDanger.value = U.uDanger.value;
    this.skyMat.uniforms.uTime.value = time;
    for (let i = 0; i < this.beacons.length; i++) {
      const b = this.beacons[i];
      b.rotation.y = time * 1.5 + i;
      b.position.y += Math.sin(time * 2 + i) * 0.004;
    }
    for (const s of this.spinners) s.rotation.y += dt * 0.01;
    // dust drifts with wind and wraps around the player
    const p = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] += dt * 1.6;
      a[i + 2] += dt * 0.4;
      a[i + 1] += Math.sin(time + i) * dt * 0.1;
      if (a[i] - px > 90) a[i] -= 180;
      if (a[i] - px < -90) a[i] += 180;
      if (a[i + 2] - pz > 90) a[i + 2] -= 180;
      if (a[i + 2] - pz < -90) a[i + 2] += 180;
    }
    p.needsUpdate = true;
  }
}
