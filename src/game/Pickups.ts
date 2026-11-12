import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import type { Assets, ModelName } from '../core/Assets';
import { heroMapper } from '../core/Assets';
import { rand, TAU } from '../core/util';
import type { Game } from './Game';

interface Gem { x: number; z: number; vx: number; vz: number; v: number; mag: boolean; t: number; y: number; vy: number }
export type PowerKind = 'heal' | 'magnet' | 'bomb';
interface Power { kind: PowerKind; x: number; z: number; t: number; obj: THREE.Group; beam: THREE.Mesh }

const GEM_COLORS = [
  new THREE.Color(0.05, 0.75, 1),
  new THREE.Color(0.15, 1, 0.3),
  new THREE.Color(0.7, 0.2, 1),
  new THREE.Color(1, 0.62, 0.08),
];
const POWER_DEF: Record<PowerKind, { model: ModelName; color: number; size: number }> = {
  heal: { model: 'barrel', color: 0xff4f6a, size: 1.6 },
  magnet: { model: 'satelliteDish_detailed', color: 0x4fffe0, size: 1.6 },
  bomb: { model: 'machine_barrel', color: 0xffaa33, size: 1.5 },
};

const iconCache = new Map<PowerKind, THREE.CanvasTexture>();
/** Holographic badge naming each supply at a glance: + repair, U tractor, starburst payload. */
function powerIcon(kind: PowerKind, color: number) {
  const hit = iconCache.get(kind);
  if (hit) return hit;
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const col = '#' + new THREE.Color(color).getHexString();
  x.translate(S / 2, S / 2);
  // hexagon frame
  x.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 52, Math.sin(a) * 52);
  }
  x.closePath();
  x.fillStyle = 'rgba(10,6,20,0.55)';
  x.fill();
  x.lineWidth = 6;
  x.strokeStyle = col;
  x.shadowColor = col;
  x.shadowBlur = 16;
  x.stroke();
  x.fillStyle = '#fff';
  x.strokeStyle = '#fff';
  x.lineCap = 'round';
  if (kind === 'heal') {
    x.fillRect(-9, -28, 18, 56);
    x.fillRect(-28, -9, 56, 18);
  } else if (kind === 'magnet') {
    x.lineWidth = 15;
    x.beginPath();
    x.arc(0, -2, 20, Math.PI, 0, true);
    x.moveTo(-20, -2); x.lineTo(-20, -26);
    x.moveTo(20, -2); x.lineTo(20, -26);
    x.stroke();
    x.fillStyle = col;
    x.fillRect(-28, -34, 16, 10);
    x.fillRect(12, -34, 16, 10);
  } else {
    x.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, r = i % 2 ? 13 : 32;
      x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  iconCache.set(kind, t);
  return t;
}

export class Pickups {
  gems: Gem[] = [];
  powers: Power[] = [];
  gemMeshes: THREE.InstancedMesh[];
  private flares: THREE.InstancedMesh;
  private gemTime = { value: 0 };
  max = 600;
  pickStreak = 0;
  pickStreakT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private beamGeo: THREE.CylinderGeometry;
  /** Comet streaks behind crystals the magnet is reeling in. */
  streaks: THREE.InstancedMesh;

  constructor(private scene: THREE.Scene, private assets: Assets, private g: Game) {
    // faceted crystals: lit, glossy, glowing from inside with a fresnel rim; individual facets
    // catch the light and twinkle, and each value tier has its own silhouette
    const gemMat = new THREE.MeshStandardMaterial({ color: 0x7a7a7a, roughness: 0.12, metalness: 0.15, flatShading: true, envMapIntensity: 0.6 });
    gemMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.gemTime;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float gF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.0);
          // per-facet twinkle: each flat face gets its own phase from its (view-space) normal
          float fid = dot(floor(normal * 6.0 + 0.5), vec3(12.9898, 78.233, 37.719));
          float tw = pow(fract(sin(fid) * 43758.5453 + uTime * 0.55), 22.0);
          #ifdef USE_COLOR
            // a little less flat glow lets the facet shading read; the fresnel rim and twinkles carry the shine
            totalEmissiveRadiance += vColor.rgb * (0.32 + gF * 1.2) + mix(vColor.rgb, vec3(1.0), 0.6) * tw * 2.6;
          #endif`,
        );
    };
    gemMat.customProgramCacheKey = () => 'gem-v2';
    const tiers = [
      (() => { const g = new THREE.OctahedronGeometry(0.28, 0); g.scale(1, 1.6, 1); return g; })(),
      // a hexagonal prism crystal with pointed ends
      new THREE.LatheGeometry([new THREE.Vector2(0, -0.46), new THREE.Vector2(0.2, -0.2), new THREE.Vector2(0.21, 0.18), new THREE.Vector2(0, 0.52)], 6),
      // a cluster of three shards
      (() => {
        const shard = (h: number, r: number) => new THREE.LatheGeometry([new THREE.Vector2(0, -0.1), new THREE.Vector2(r, 0.05), new THREE.Vector2(r * 0.9, h * 0.7), new THREE.Vector2(0, h)], 6);
        const a = shard(0.75, 0.17);
        const b = shard(0.5, 0.13); b.rotateZ(0.55); b.translate(0.17, -0.08, 0.05);
        const c = shard(0.45, 0.12); c.rotateZ(-0.5); c.rotateX(0.35); c.translate(-0.15, -0.1, -0.07);
        const m = mergeGeometries([a, b, c], false)!;
        m.translate(0, -0.25, 0);
        return m;
      })(),
      // a brilliant-cut jewel: wide girdle, shallow crown, deep pavilion
      new THREE.LatheGeometry([new THREE.Vector2(0, -0.4), new THREE.Vector2(0.4, 0.02), new THREE.Vector2(0.4, 0.07), new THREE.Vector2(0.26, 0.2), new THREE.Vector2(0, 0.22)], 8),
    ];
    this.gemMeshes = tiers.map((geo) => {
      const m = new THREE.InstancedMesh(geo, gemMat, this.max);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      for (let i = 0; i < this.max; i++) m.setColorAt(i, GEM_COLORS[0]);
      scene.add(m);
      return m;
    });
    // star glints over precious crystals
    {
      const fm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vCol;
          void main(){
            vUv = uv; vCol = instanceColor;
            vec4 c = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float s = length(instanceMatrix[0].xyz);
            c.xy += position.xy * s;
            gl_Position = projectionMatrix * c;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vCol;
          void main(){
            vec2 p = (vUv - 0.5) * 2.0;
            float ax = exp(-abs(p.y) * 26.0) * (1.0 - abs(p.x));
            float ay = exp(-abs(p.x) * 26.0) * (1.0 - abs(p.y));
            float core = exp(-dot(p, p) * 18.0);
            float a = ax + ay + core;
            gl_FragColor = vec4((vCol * 0.8 + 0.6) * a, 1.0);
          }`,
      });
      this.flares = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), fm, 64);
      this.flares.count = 0;
      this.flares.frustumCulled = false;
      this.flares.renderOrder = 3;
      for (let i = 0; i < 64; i++) this.flares.setColorAt(i, GEM_COLORS[3]);
      scene.add(this.flares);
    }
    {
      const sg = new THREE.PlaneGeometry(1, 1);
      sg.rotateX(-Math.PI / 2); // lie on XZ; uv.y runs along local -z
      sg.translate(0, 0, 0.5); // head at the origin, tail trailing along +z
      const sm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vCol;
          void main(){ vUv = uv; vCol = instanceColor; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vCol;
          void main(){
            float along = vUv.y;               // 1 at the head, 0 at the tail
            float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float core = pow(across, 3.0 - along * 1.5);
            float a = pow(along, 1.6) * core;
            gl_FragColor = vec4((vCol * 1.6 + vec3(0.25) * along * core) * a, 1.0);
          }`,
      });
      this.streaks = new THREE.InstancedMesh(sg, sm, this.max);
      this.streaks.count = 0;
      this.streaks.frustumCulled = false;
      this.streaks.renderOrder = 1;
      for (let i = 0; i < this.max; i++) this.streaks.setColorAt(i, GEM_COLORS[0]);
      scene.add(this.streaks);
    }
    this.beamGeo = new THREE.CylinderGeometry(0.25, 0.5, 9, 20, 1, true);
    this.beamGeo.translate(0, 4.5, 0);
  }

  clear() {
    this.gems.length = 0;
    for (const p of this.powers) this.scene.remove(p.obj, p.beam);
    this.powers.length = 0;
  }

  dropGem(x: number, z: number, v: number) {
    if (this.gems.length >= this.max) {
      // fold into the oldest gem so value is never lost
      const o = this.gems[0];
      o.v += v;
      return;
    }
    const a = rand(0, TAU);
    const s = rand(1, 3);
    this.gems.push({ x, z, vx: Math.cos(a) * s, vz: Math.sin(a) * s, v, mag: false, t: 0, y: 1.2, vy: rand(3, 6) });
  }

  dropPower(kind: PowerKind, x: number, z: number) {
    const def = POWER_DEF[kind];
    const obj = this.assets.object(def.model, def.size, heroMapper(def.color, 2.5));
    obj.position.set(x, 0.4, z);
    const beam = new THREE.Mesh(
      this.beamGeo,
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(def.color) }, opacity: { value: 0.2 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float opacity; uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            float fade = pow(1.0 - vUv.y, 2.0);
            float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
            float bands = 0.7 + 0.3 * sin(vUv.y * 40.0 - uTime * 6.0);
            gl_FragColor = vec4(uColor * fade * (0.25 + edge * 1.2) * bands * opacity * 3.0, 1.0);
          }`,
      }),
    );
    beam.position.set(x, 0, z);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: powerIcon(kind, def.color), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    icon.scale.setScalar(1.9);
    icon.position.y = 2.7;
    icon.renderOrder = 7;
    obj.add(icon);
    this.scene.add(obj, beam);
    this.powers.push({ kind, x, z, t: 0, obj, beam });
  }

  magnetAll() {
    for (const gm of this.gems) gm.mag = true;
  }

  private gemColor(v: number) {
    return v >= 20 ? GEM_COLORS[3] : v >= 5 ? GEM_COLORS[2] : v >= 2 ? GEM_COLORS[1] : GEM_COLORS[0];
  }

  private mergeT = 0;
  /** When the field gets crowded, fold idle neighbouring crystals into bigger ones. */
  private mergeGems() {
    if (this.gems.length < 120) return;
    const cells = new Map<number, Gem>();
    const cs = this.gems.length > 300 ? 3 : 2;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const gm = this.gems[i];
      if (gm.mag) continue;
      const k = (Math.floor(gm.x / cs) + 4096) * 8192 + Math.floor(gm.z / cs) + 4096;
      const host = cells.get(k);
      if (host) {
        host.v += gm.v;
        this.gems[i] = this.gems[this.gems.length - 1];
        this.gems.pop();
      } else cells.set(k, gm);
    }
  }

  update(dt: number) {
    const g = this.g;
    const P = g.player;
    this.mergeT -= dt;
    if (this.mergeT <= 0) {
      this.mergeT = 0.5;
      this.mergeGems();
    }
    this.pickStreakT -= dt;
    if (this.pickStreakT <= 0) this.pickStreak = 0;
    const mr = P.magnet;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const gm = this.gems[i];
      gm.t += dt;
      // pop-out arc
      if (gm.y > 0.6 || gm.vy > 0) {
        gm.vy -= 18 * dt;
        gm.y = Math.max(0.6, gm.y + gm.vy * dt);
        if (gm.y <= 0.6) gm.vy = 0;
      }
      const dx = P.x - gm.x, dz = P.z - gm.z;
      const d = Math.hypot(dx, dz);
      if (!P.dead && (gm.mag || d < mr)) {
        gm.mag = true;
        const sp = 10 + gm.t * 4 + (gm.mag ? 18 : 0);
        gm.vx += ((dx / (d || 1)) * sp - gm.vx) * Math.min(1, dt * 8);
        gm.vz += ((dz / (d || 1)) * sp - gm.vz) * Math.min(1, dt * 8);
      } else {
        gm.vx *= Math.exp(-4 * dt);
        gm.vz *= Math.exp(-4 * dt);
      }
      gm.x += gm.vx * dt;
      gm.z += gm.vz * dt;
      if (gm.mag && Math.random() < 0.25) g.particles.emit(gm.x, gm.y, gm.z, 0, 0, 0, 0.22, 0.35, this.gemColor(gm.v), 0);
      if (!P.dead && d < P.r + 0.6) {
        this.pickStreak++;
        this.pickStreakT = 0.6;
        g.gainXp(gm.v);
        g.audio.sfx('pick', this.pickStreak);
        g.particles.emit(gm.x, 1, gm.z, 0, 2, 0, 0.25, 0.7, this.gemColor(gm.v), 2);
        this.gems[i] = this.gems[this.gems.length - 1];
        this.gems.pop();
      }
    }

    for (let i = this.powers.length - 1; i >= 0; i--) {
      const p = this.powers[i];
      p.t += dt;
      p.obj.rotation.y += dt * 1.8;
      p.obj.position.y = 0.5 + Math.sin(p.t * 3) * 0.25;
      const fading = p.t > 22;
      const vis = !fading || Math.floor(p.t * 8) % 2 === 0;
      p.obj.visible = vis;
      const bm = p.beam.material as THREE.ShaderMaterial;
      bm.uniforms.opacity.value = 0.16 + Math.sin(p.t * 4) * 0.06;
      bm.uniforms.uTime.value = p.t;
      p.beam.visible = vis;
      const d = Math.hypot(P.x - p.x, P.z - p.z);
      if (!P.dead && d < P.r + 1.1) {
        g.collectPower(p.kind, p.x, p.z);
        this.scene.remove(p.obj, p.beam);
        this.powers.splice(i, 1);
      } else if (p.t > 26) {
        this.scene.remove(p.obj, p.beam);
        this.powers.splice(i, 1);
      }
    }
  }

  sync(time: number) {
    this.gemTime.value = time % 1000;
    // the death cam orbits low and close: a capsule parked in its path would fill the whole lens
    if (this.g.player.dead) {
      const c = this.g.r.camera.position;
      for (const p of this.powers) if (Math.hypot(c.x - p.x, c.z - p.z) < 7) p.obj.visible = p.beam.visible = false;
    }
    const nt = [0, 0, 0, 0];
    let nf = 0;
    for (let i = 0; i < this.gems.length; i++) {
      const gm = this.gems[i];
      const tier = gm.v >= 20 ? 3 : gm.v >= 5 ? 2 : gm.v >= 2 ? 1 : 0;
      const sc = [1, 1.15, 1.3, 1.55][tier];
      const y = gm.y + Math.sin(time * 4 + i) * 0.12 + (tier === 3 ? 0.25 : 0);
      // precious jewels tilt and spin slower so their facets roll through the light
      this.e.set(tier === 3 ? 0.75 : 0, time * (tier === 3 ? 1.4 : 2.5) + i, tier === 3 ? Math.sin(time * 1.3 + i) * 0.3 : 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(gm.x, y, gm.z), this.q, this.s.set(sc, sc, sc));
      const mesh = this.gemMeshes[tier];
      mesh.setMatrixAt(nt[tier], this.m);
      mesh.setColorAt(nt[tier], GEM_COLORS[tier]);
      nt[tier]++;
      if (tier >= 2 && nf < 64) {
        // a cross-star glint that blooms and fades on its own rhythm
        const ph = (time * 0.7 + i * 0.37) % 1;
        const k = tier === 3 ? 1 : 0.5;
        const fs = Math.max(0, Math.sin(ph * Math.PI)) ** 6 * (1.6 + tier * 0.5) * k + (tier === 3 ? 0.45 : 0);
        if (fs > 0.02) {
          this.m.compose(this.p.set(gm.x, y + 0.15, gm.z), this.q.identity(), this.s.set(fs, fs, fs));
          this.flares.setMatrixAt(nf, this.m);
          this.flares.setColorAt(nf, GEM_COLORS[tier]);
          nf++;
        }
      }
    }
    for (let t = 0; t < 4; t++) {
      const mesh = this.gemMeshes[t];
      mesh.count = nt[t];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.flares.count = nf;
    this.flares.instanceMatrix.needsUpdate = true;
    if (this.flares.instanceColor) this.flares.instanceColor.needsUpdate = true;

    // streaks: only for crystals in flight toward the ship, length follows speed
    let n = 0;
    for (let i = 0; i < this.gems.length; i++) {
      const gm = this.gems[i];
      if (!gm.mag) continue;
      const sp = Math.hypot(gm.vx, gm.vz);
      if (sp < 4) continue;
      const sc = gm.v >= 20 ? 2 : gm.v >= 5 ? 1.5 : gm.v >= 2 ? 1.2 : 1;
      const len = Math.min(2.4, sp * 0.07) * (0.8 + sc * 0.2);
      this.e.set(0, Math.atan2(-gm.vx, -gm.vz), 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(gm.x, gm.y - 0.05, gm.z), this.q, this.s.set(0.32 * sc, 1, len));
      this.streaks.setMatrixAt(n, this.m);
      this.streaks.setColorAt(n, this.gemColor(gm.v));
      n++;
    }
    this.streaks.count = n;
    this.streaks.instanceMatrix.needsUpdate = true;
    if (this.streaks.instanceColor) this.streaks.instanceColor.needsUpdate = true;
  }
}
