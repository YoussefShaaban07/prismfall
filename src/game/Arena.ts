import * as THREE from 'three';
import type { Assets, ModelName } from '../core/Assets';
import { heroMapper, alienMapper } from '../core/Assets';
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
  private flareEls: { el: LensflareElement; size: number; day: THREE.Color; night: THREE.Color }[] = [];
  sunHolder = new THREE.Object3D();
  windBoost = 1;
  rotors: { o: THREE.Object3D; speed: number; sweep: boolean }[] = [];
  searchlights: { cone: THREE.Mesh; spot: THREE.Mesh; base: THREE.Vector3; phase: number; speed: number }[] = [];
  private chase!: THREE.InstancedMesh;
  private blinkers: THREE.Mesh[] = [];
  private chaseC = new THREE.Color();
  private slUp = new THREE.Vector3(0, 1, 0);
  private slDir = new THREE.Vector3();
  night = false;
  private glowMats: { m: THREE.MeshStandardMaterial; base: number }[] = [];

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
          vec2 vhash2(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
          // distance to the nearest Voronoi edge: glowing prism fissures in the ground
          float fissure(vec2 x){
            vec2 n = floor(x), f = fract(x); vec2 mg, mr; float md = 8.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec2 o = vhash2(n + g); vec2 r = g + o - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }
            md = 8.0;
            for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 g = mg + vec2(float(i), float(j)); vec2 o = vhash2(n + g); vec2 r = g + o - f; if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }
            return md;
          }
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
            em += mix(vec3(1.0, 0.35, 0.8), vec3(0.3, 0.9, 1.0), 0.5 + 0.5 * sin(atan(p.y, p.x) * 6.0 + uTime)) * edge * 0.6;
            em += cyan * near * 0.05;
            // prism fissures: thin crystal-energy cracks that pulse outward from the arena centre
            vec2 fp = p * 0.075;
            float fw = fwidth(fp.x) * 1.2;
            // the Voronoi is the priciest thing in the ground shader: skip it outside the arena
            float fd = inside > 0.001 ? fissure(fp) : 1.0;
            float crack = (1.0 - smoothstep(0.0, fw, fd)) * inside;
            float wave = 0.08 + 0.92 * pow(0.5 + 0.5 * sin(r * 0.22 - uTime * 1.4), 12.0);
            vec3 crackCol = mix(vec3(0.3, 0.9, 1.0), vec3(0.75, 0.4, 1.0), 0.5 + 0.5 * sin(p.x * 0.05 + p.y * 0.04));
            em += crackCol * crack * wave * (0.5 + uNight * 0.6 + uPulse * 1.2);
            diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, fw * 3.0, fd)) * inside * 0.3;
            totalEmissiveRadiance += em;
            diffuseColor.rgb *= mix(0.55, 1.0, inside);
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.62, 0.66, 0.9), uNight);
          }`);
    };
    const tg = new THREE.PlaneGeometry(800, 800, 200, 200);
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
      uniforms: { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector2() }, uDanger: { value: 0 }, uImp: { value: Array.from({ length: 6 }, () => new THREE.Vector2(0, -99)) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW; uniform float uTime; uniform vec2 uPlayer; uniform float uDanger; uniform vec2 uImp[6];
        float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
        void main(){
          float h = vUv.y;
          float fade = pow(1.0 - h, 2.2);
          float hx = smoothstep(0.0, 0.08, hex(vec2(vUv.x * 160.0, vUv.y * 6.0 - uTime * 0.6)));
          float lines = 1.0 - hx;
          float scan = smoothstep(0.96, 1.0, sin(vUv.y * 40.0 - uTime * 6.0));
          float d = length(vW.xz - uPlayer);
          float prox = exp(-d * 0.2) * 0.45;
          vec3 col = mix(vec3(0.15, 0.75, 1.0), vec3(1.0, 0.3, 0.75), 0.5 + 0.5 * sin(vUv.x * 6.2831 * 3.0 + uTime * 0.7));
          col = mix(col, vec3(1.0, 0.2, 0.3), uDanger * 0.6);
          float a = fade * (0.12 + lines * (0.35 + prox) + scan * 0.25) + exp(-h * 18.0) * 0.55;
          // impact ripples: hex cells light up in an expanding ring around each hit
          float ang = atan(vW.z, vW.x);
          float imp = 0.0;
          for (int i = 0; i < 6; i++) {
            float dt = uTime - uImp[i].y;
            if (dt < 0.0 || dt > 1.2) continue;
            float da = abs(mod(ang - uImp[i].x + 3.14159, 6.28318) - 3.14159) * 62.0;
            float dy = (vUv.y * 7.0) - 1.0;
            float d = length(vec2(da, dy));
            imp += exp(-pow((d - dt * 9.0) * 0.9, 2.0)) * (1.0 - dt / 1.2) * (0.4 + lines) + exp(-d * 0.8) * max(0.0, 0.3 - dt) * 1.2;
          }
          col = mix(col, vec3(1.0, 0.95, 1.0), clamp(imp * 0.25, 0.0, 0.35));
          a += imp * 0.35 * fade;
          // grazing angles stack many additive layers into a hot line; damp them
          vec3 nrm = normalize(vec3(vW.x, 0.0, vW.z));
          float facing = abs(dot(nrm, normalize(cameraPosition - vW)));
          a *= mix(0.22, 1.0, smoothstep(0.04, 0.45, facing));
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
      // satellite dishes and turrets stay live so they can rotate
      if (name.startsWith('satelliteDish') || name.startsWith('turret')) {
        this.group.add(o);
        this.rotors.push({ o, speed: rand(0.15, 0.45) * (Math.random() < 0.5 ? -1 : 1), sweep: name.startsWith('turret') });
      } else statics.add(o);
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
    // fallen prism shards: glowing crystal clusters embedded around the arena
    const crystalCols = [0x5ef2ff, 0xff4fd8, 0xb48bff];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + rand(-0.15, 0.15);
      const r = rand(14, ARENA_RADIUS - 6);
      const c = crystalCols[i % 3];
      const o = assets.object(Math.random() < 0.5 ? 'rock_crystalsLargeA' : 'rock_crystalsLargeB', rand(3, 5), alienMapper(c, 2.2, 1.2));
      o.position.set(Math.cos(a) * r, -0.4, Math.sin(a) * r);
      o.rotation.y = rand(0, TAU);
      statics.add(o);
    }
    const baked = bakeStatic(statics, true);
    baked.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex() !== 0) this.glowMats.push({ m, base: m.emissiveIntensity });
    });
    this.group.add(baked);

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
          // shooting stars: three slots on staggered timers, each a short bright streak that burns out
          if (y > 0.1) {
            float az = atan(vDir.z, vDir.x);
            float el = asin(clamp(y, -1.0, 1.0));
            for (int i = 0; i < 3; i++) {
              float fi = float(i);
              float tt = uTime / (5.5 + fi * 2.9) + fi * 0.37;
              float id = floor(tt), ph = fract(tt);
              if (ph > 0.16) continue;
              float k = ph / 0.16;
              vec2 st0 = vec2(h2(vec2(id, fi)) * 6.2832 - 3.1416, 0.35 + h2(vec2(fi + 2.0, id)) * 0.45);
              float c = cos(st0.y);
              vec2 dir = normalize(vec2(h2(vec2(id + 3.0, fi)) - 0.5, -0.3 - h2(vec2(fi + 7.0, id)) * 0.4));
              vec2 head = vec2(st0.x * c, st0.y) + dir * k * 0.55;
              vec2 d = vec2(az * c, el) - head;
              d.x = mod(d.x + 3.1416 * c, 6.2832 * c) - 3.1416 * c;
              float along = dot(d, -dir);
              float across = abs(d.x * dir.y - d.y * dir.x);
              float m = step(0.0, along) * (1.0 - smoothstep(0.0, 0.22, along)) * (1.0 - smoothstep(0.0, 0.0026 + along * 0.008, across));
              m += exp(-dot(d, d) * 9000.0) * 1.5; // the burning head
              col += vec3(1.0, 0.82, 0.62) * m * sin(k * 3.1416) * (1.6 + uNight * 1.4);
            }
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

    /* ----- ground detail: thousands of instanced pebbles and grit ----- */
    {
      const pg = new THREE.DodecahedronGeometry(0.18, 0);
      const pm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
      const N = 2600;
      const im = new THREE.InstancedMesh(pg, pm, N);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      const col = new THREE.Color();
      for (let i = 0; i < N; i++) {
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * (R + 24);
        const k = rand(0.3, 1.1) * (Math.random() < 0.06 ? 2.2 : 1);
        e.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
        q.setFromEuler(e);
        m4.compose(v.set(Math.cos(a) * r, 0.02, Math.sin(a) * r), q, sc.set(k * rand(0.8, 1.4), k * 0.55, k));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setHSL(0.03 + rand(-0.01, 0.02), rand(0.4, 0.55), rand(0.3, 0.48)));
      }
      im.receiveShadow = true;
      im.castShadow = false;
      this.group.add(im);
    }

    /* ----- colony searchlights (visible on Night Shift) ----- */
    const coneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0.45, 0.62, 1.0) } },
      vertexShader: /* glsl */ `varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){ vT = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = pow(vT, 1.6) * edge * edge * 0.12; gl_FragColor = vec4(uColor * a, 1.0); }`,
    });
    const spotTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      // a lit disc with a crisp, slightly brighter rim reads as a beam hitting the ground, not as fog
      gr.addColorStop(0, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.42)');
      gr.addColorStop(0.82, 'rgba(255,255,255,0.62)');
      gr.addColorStop(0.92, 'rgba(255,255,255,0.18)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    })();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      const base = new THREE.Vector3(Math.cos(a) * (R + 14), 14, Math.sin(a) * (R + 14));
      const coneGeo = new THREE.CylinderGeometry(0.4, 6, 1, 24, 1, true);
      coneGeo.translate(0, -0.5, 0);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.renderOrder = 6;
      const spotGeo = new THREE.PlaneGeometry(1, 1);
      spotGeo.rotateX(-Math.PI / 2);
      const spot = new THREE.Mesh(spotGeo, new THREE.MeshBasicMaterial({ map: spotTex, color: new THREE.Color(0.17, 0.25, 0.52), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      spot.renderOrder = 2;
      cone.visible = spot.visible = false;
      this.group.add(cone, spot);
      this.searchlights.push({ cone, spot, base, phase: i * 1.7, speed: 0.18 + i * 0.03 });
    }

    /* ----- night runway: chase lights around the perimeter + aviation blinkers on the light towers ----- */
    {
      const n = 132;
      const geo = new THREE.SphereGeometry(0.3, 8, 6);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      this.chase = new THREE.InstancedMesh(geo, mat, n);
      const m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        m.makeTranslation(Math.cos(a) * (R + 1.3), 0.22, Math.sin(a) * (R + 1.3));
        this.chase.setMatrixAt(i, m);
        this.chase.setColorAt(i, new THREE.Color(0, 0, 0));
      }
      this.chase.visible = false;
      this.group.add(this.chase);
      const bGeo = new THREE.SphereGeometry(0.35, 10, 8);
      for (const s of this.searchlights) {
        const b = new THREE.Mesh(bGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.15), toneMapped: false }));
        b.position.copy(s.base).add(new THREE.Vector3(0, 2.2, 0));
        b.visible = false;
        this.group.add(b);
        this.blinkers.push(b);
      }
    }

    /* ----- sun lens flare ----- */
    this.flare = new Lensflare();
    const core = flareTex('core'), ring = flareTex('ring'), hex = flareTex('hex');
    // [texture, size, distance, dusk colour (warm sun), night colour (cold, dimmer moonlight)]
    const els: [THREE.Texture, number, number, number[], number[]][] = [
      [core, 420, 0, [1, 0.85, 0.7], [0.62, 0.74, 1]],
      [ring, 220, 0.25, [1, 0.6, 0.4], [0.3, 0.42, 0.75]],
      [hex, 40, 0.45, [0.35, 0.25, 0.45], [0.22, 0.24, 0.45]],
      [hex, 60, 0.62, [0.2, 0.35, 0.45], [0.16, 0.3, 0.42]],
      [ring, 120, 0.85, [0.4, 0.28, 0.2], [0.14, 0.2, 0.34]],
    ];
    for (const [tex, size, dist, day, night] of els) {
      const el = new LensflareElement(tex, size, dist, new THREE.Color(...day));
      this.flareEls.push({ el, size, day: new THREE.Color(...day), night: new THREE.Color(...night) });
      this.flare.addElement(el);
    }
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

  private impIdx = 0;
  private impLast = 0;
  /** Flash the force field where something hit it. */
  wallImpact(x: number, z: number, time: number) {
    if (time - this.impLast < 0.12) return;
    this.impLast = time;
    const arr = this.wallMat.uniforms.uImp.value as THREE.Vector2[];
    arr[this.impIdx].set(Math.atan2(z, x), time);
    this.impIdx = (this.impIdx + 1) % arr.length;
  }

  /** Keep the flare source on the sun direction, far from the camera. */
  placeSun(cam: THREE.Camera, night: boolean) {
    const d = night ? new THREE.Vector3(0.4, 0.45, -0.6) : new THREE.Vector3(-0.55, 0.18, 0.35);
    d.normalize().multiplyScalar(850);
    this.sunHolder.position.copy(cam.position).add(d);
  }

  setNight(n: boolean) {
    this.night = n;
    // the flare follows the moon after dark: cold and smaller instead of the warm dusk sun
    for (const f of this.flareEls) {
      f.el.color.copy(n ? f.night : f.day);
      f.el.size = f.size * (n ? 0.75 : 1);
    }
    // colony lights burn brighter after dark
    for (const g of this.glowMats) g.m.emissiveIntensity = g.base * (n ? 2.2 : 1);
    for (const s of this.searchlights) s.cone.visible = s.spot.visible = n;
    this.chase.visible = n;
    for (const b of this.blinkers) b.visible = n;
  }

  /** Runway chase: pulses run around the perimeter in both directions; towers blink red. */
  private updateRunway(time: number) {
    if (!this.night) return;
    const n = this.chase.count;
    const c = this.chaseC;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = Math.pow(Math.max(0, Math.sin((u * 6 - time * 0.55) * TAU * 0.5)), 24);
      const b = Math.pow(Math.max(0, Math.sin((u * 4 + time * 0.35) * TAU * 0.5)), 24);
      const base = 0.35;
      c.setRGB(base * 0.5 + a * 4 + b * 0.8, base * 0.8 + a * 3.2 + b * 1.8, base * 1.6 + a * 1.8 + b * 4.2);
      this.chase.setColorAt(i, c);
    }
    if (this.chase.instanceColor) this.chase.instanceColor.needsUpdate = true;
    for (let i = 0; i < this.blinkers.length; i++) this.blinkers[i].visible = ((time * 0.9 + i * 0.25) % 1) < 0.22;
  }

  private updateSearchlights(time: number) {
    if (!this.night) return;
    const up = this.slUp;
    for (const s of this.searchlights) {
      const t = time * s.speed + s.phase;
      const r = 14 + Math.sin(t * 1.3) * 30 + 20;
      const tx = Math.cos(t) * r, tz = Math.sin(t * 0.8) * r;
      const dir = this.slDir.set(tx, 0, tz).sub(s.base);
      const len = dir.length();
      s.cone.position.copy(s.base);
      s.cone.quaternion.setFromUnitVectors(up, dir.normalize().negate());
      s.cone.scale.set(1, len, 1);
      s.spot.position.set(tx, 0.09, tz);
      s.spot.scale.set(13, 1, 13);
    }
  }

  update(dt: number, time: number, px: number, pz: number, danger: number) {
    this.updateSearchlights(time);
    this.updateRunway(time);
    for (const r of this.rotors) {
      if (r.sweep) r.o.rotation.y = Math.sin(time * r.speed * 2 + r.speed * 40) * 1.2 + r.speed * 20;
      else r.o.rotation.y += dt * r.speed;
    }
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
      a[i] += dt * 1.6 * this.windBoost;
      a[i + 2] += dt * 0.4 * this.windBoost;
      a[i + 1] += Math.sin(time + i) * dt * 0.1;
      if (a[i] - px > 90) a[i] -= 180;
      if (a[i] - px < -90) a[i] += 180;
      if (a[i + 2] - pz > 90) a[i + 2] -= 180;
      if (a[i + 2] - pz < -90) a[i + 2] += 180;
    }
    p.needsUpdate = true;
  }
}
