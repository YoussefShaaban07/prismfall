import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Open-source assets used by the game:
 *  - 3D models: Kenney "Space Kit" (CC0) and Kenney "Starter Kit FPS" enemy drone (MIT)
 *  - HDR environment: Poly Haven HDRIs via @pmndrs/assets (CC0)
 *  - Normal maps: @pmndrs/assets (CC0)
 * See CREDITS.md.
 */
export const MODEL_NAMES = [
  'craft_speederA', 'craft_speederB', 'craft_speederC', 'craft_speederD', 'craft_racer',
  'craft_cargoA', 'craft_cargoB', 'craft_miner', 'meteor', 'meteor_detailed', 'meteor_half',
  'rocks_smallA', 'rocks_smallB', 'rock', 'rock_largeA', 'rock_largeB', 'rock_crystals',
  'rock_crystalsLargeA', 'rock_crystalsLargeB', 'crater', 'craterLarge', 'hangar_largeA',
  'hangar_roundA', 'hangar_roundB', 'hangar_roundGlass', 'hangar_smallA', 'rocket_baseA',
  'rocket_fuelA', 'rocket_sidesA', 'rocket_topA', 'rocket_finsA', 'satelliteDish_large',
  'satelliteDish_detailed', 'machine_generatorLarge', 'machine_wireless', 'machine_barrel',
  'barrel', 'barrels', 'turret_double', 'turret_single', 'alien', 'structure_detailed',
  'supports_high', 'pipe_straight', 'pipe_ring', 'gate_complex', 'rover', 'astronautA',
  'platform_large', 'enemy-flying',
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

export interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  matName: string;
}
export interface Model {
  parts: Part[];
  /** normalized size: largest horizontal extent is 1 */
  height: number;
}

export type MatMapper = (matName: string, src: THREE.MeshStandardMaterial) => THREE.Material;

const BASE = import.meta.env.BASE_URL;

export class Assets {
  models = new Map<string, Model>();
  env: THREE.Texture | null = null;
  envNight: THREE.Texture | null = null;
  groundNormal: THREE.Texture | null = null;

  async load(renderer: THREE.WebGLRenderer, onProgress: (p: number) => void) {
    const gltf = new GLTFLoader();
    const total = MODEL_NAMES.length + 3;
    let done = 0;
    const tick = () => onProgress(++done / total);

    const modelJobs = MODEL_NAMES.map(async (name) => {
      try {
        const g = await gltf.loadAsync(`${BASE}models/${name}.glb`);
        this.models.set(name, this.bake(g.scene));
      } catch (e) {
        console.warn('model failed', name, e);
        this.models.set(name, this.fallback());
      }
      tick();
    });

    const pmrem = new THREE.PMREMGenerator(renderer);
    const exr = new EXRLoader();
    const envJob = (async () => {
      try {
        const t = await exr.loadAsync(`${BASE}hdri/sunset.exr`);
        t.mapping = THREE.EquirectangularReflectionMapping;
        this.env = pmrem.fromEquirectangular(t).texture;
        t.dispose();
      } catch (e) {
        console.warn('env failed', e);
      }
      tick();
    })();
    const envJob2 = (async () => {
      try {
        const t = await exr.loadAsync(`${BASE}hdri/night.exr`);
        t.mapping = THREE.EquirectangularReflectionMapping;
        this.envNight = pmrem.fromEquirectangular(t).texture;
        t.dispose();
      } catch (e) {
        console.warn('env2 failed', e);
      }
      tick();
    })();
    const texJob = (async () => {
      try {
        const t = await new THREE.TextureLoader().loadAsync(`${BASE}textures/normal_0010.webp`);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        this.groundNormal = t;
      } catch (e) {
        console.warn('normal failed', e);
      }
      tick();
    })();

    await Promise.all([...modelJobs, envJob, envJob2, texJob]);
    pmrem.dispose();
  }

  /** Flatten a glTF scene into one merged geometry per material, normalized to unit footprint. */
  private bake(root: THREE.Object3D): Model {
    root.updateMatrixWorld(true);
    const byMat = new Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.MeshStandardMaterial }>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const src = m.geometry.clone();
      src.applyMatrix4(m.matrixWorld);
      if (mats.length === 1 || src.groups.length === 0) {
        const mat = mats[0] as THREE.MeshStandardMaterial;
        this.addGeo(byMat, mat, src);
      } else {
        for (const grp of src.groups) {
          const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
          const sub = this.extractGroup(src, grp.start, grp.count);
          this.addGeo(byMat, mat, sub);
        }
      }
    });
    const parts: Part[] = [];
    const box = new THREE.Box3();
    for (const [name, { geos, mat }] of byMat) {
      const allUv = geos.every((g) => !!g.getAttribute('uv'));
      const cleaned = geos.map((g) => {
        const keep = new THREE.BufferGeometry();
        const ng = g.index ? g.toNonIndexed() : g;
        keep.setAttribute('position', ng.getAttribute('position'));
        if (ng.getAttribute('normal')) keep.setAttribute('normal', ng.getAttribute('normal'));
        else keep.computeVertexNormals();
        if (allUv) keep.setAttribute('uv', ng.getAttribute('uv'));
        return keep;
      });
      const merged = cleaned.length === 1 ? cleaned[0] : mergeGeometries(cleaned, false);
      if (!merged) continue;
      merged.computeBoundingBox();
      box.union(merged.boundingBox!);
      parts.push({ geo: merged, mat, matName: name });
    }
    // normalize: center x/z, ground y=0, largest horizontal extent -> 1
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const s = 1 / Math.max(size.x, size.z, 0.0001);
    const mtx = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
    for (const p of parts) {
      p.geo.applyMatrix4(mtx);
      p.geo.computeBoundingSphere();
      p.geo.computeBoundingBox();
    }
    return { parts, height: size.y * s };
  }

  private addGeo(map: Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.MeshStandardMaterial }>, mat: THREE.MeshStandardMaterial, g: THREE.BufferGeometry) {
    const key = mat.name || 'mat';
    if (!map.has(key)) map.set(key, { geos: [], mat });
    map.get(key)!.geos.push(g);
  }

  private extractGroup(g: THREE.BufferGeometry, start: number, count: number) {
    const ng = g.index ? g.toNonIndexed() : g;
    const out = new THREE.BufferGeometry();
    for (const attr of ['position', 'normal', 'uv'] as const) {
      const a = ng.getAttribute(attr) as THREE.BufferAttribute | undefined;
      if (!a) continue;
      const arr = (a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize);
      out.setAttribute(attr, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return out;
  }

  private fallback(): Model {
    const geo = new THREE.OctahedronGeometry(0.5).toNonIndexed();
    geo.translate(0, 0.5, 0);
    return { parts: [{ geo, mat: new THREE.MeshStandardMaterial({ color: 0xff00ff }), matName: 'metal' }], height: 1 };
  }

  get(name: ModelName): Model {
    return this.models.get(name) ?? this.fallback();
  }

  /** Build a regular (non-instanced) object from a model. */
  object(name: ModelName, size = 1, mapper?: MatMapper, shadows = true): THREE.Group {
    const model = this.get(name);
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(size);
    g.add(inner);
    for (const p of model.parts) {
      const mat = mapper ? mapper(p.matName, p.mat) : p.mat;
      const mesh = new THREE.Mesh(p.geo, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      inner.add(mesh);
    }
    g.userData.height = model.height * size;
    return g;
  }
}

/* ---------------- materials ---------------- */

export interface RimUniforms {
  uRim: { value: THREE.Color };
  uRimK: { value: number };
  uFlash: { value: number };
}

/**
 * Patch a standard material with a view-dependent neon rim light and a flash term.
 * Works for both instanced meshes (per-instance aFlash attribute) and regular meshes (uFlash uniform).
 */
export function addRim(mat: THREE.MeshStandardMaterial, rim: THREE.ColorRepresentation, k = 1.2): THREE.MeshStandardMaterial {
  const u: RimUniforms = { uRim: { value: new THREE.Color(rim) }, uRimK: { value: k }, uFlash: { value: 0 } };
  mat.userData.rim = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlash;\nvarying float vFlash;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = aFlash;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimK; uniform float uFlash; varying float vFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.4);
        totalEmissiveRadiance += uRim * rimF * uRimK + vec3(1.0, 0.95, 0.9) * (vFlash + uFlash) * 1.6;`,
      );
  };
  mat.customProgramCacheKey = () => 'rim-v1';
  return mat;
}

/** Recolor Kenney materials into an "alien" palette with glowing accents. */
export function alienMapper(color: THREE.ColorRepresentation, glow = 2.6, rimK = 1.1): MatMapper {
  const c = new THREE.Color(color);
  return (name, src) => {
    let m: THREE.MeshStandardMaterial;
    switch (name) {
      case 'metalRed':
      case 'crystal':
      case '_defaultMat':
        m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: glow, roughness: 0.3, metalness: 0.2 });
        break;
      case 'metal':
        m = new THREE.MeshStandardMaterial({ color: 0x4a4560, roughness: 0.35, metalness: 0.75 });
        break;
      case 'metalDark':
        m = new THREE.MeshStandardMaterial({ color: 0x2a2638, roughness: 0.4, metalness: 0.7 });
        break;
      case 'dark':
        m = new THREE.MeshStandardMaterial({ color: 0x0c0a12, roughness: 0.5, metalness: 0.4 });
        break;
      case 'rock':
      case 'rockTrack':
        m = new THREE.MeshStandardMaterial({ color: 0x5a3328, roughness: 0.9, metalness: 0.05 });
        break;
      default:
        m = src.clone() as THREE.MeshStandardMaterial;
        if (m.map) {
          m.color = new THREE.Color(0.55, 0.5, 0.7);
          m.emissive = c.clone();
          m.emissiveMap = m.map;
          m.emissiveIntensity = 0.5;
        }
    }
    m.flatShading = true;
    return addRim(m, c, rimK);
  };
}

/** Keep original Kenney colors but tune them for the scene; accents glow softly. */
export function heroMapper(accent: THREE.ColorRepresentation = 0xff9a3c, glow = 0.6): MatMapper {
  const a = new THREE.Color(accent);
  return (name, src) => {
    const m = src.clone() as THREE.MeshStandardMaterial;
    m.flatShading = true;
    if (name === 'metal') { m.metalness = 0.55; m.roughness = 0.3; }
    if (name === 'metalDark') { m.metalness = 0.6; m.roughness = 0.35; }
    if (name === 'metalRed') { m.color = a.clone(); m.emissive = a.clone(); m.emissiveIntensity = glow; }
    if (name === 'crystal') { m.emissive = m.color.clone(); m.emissiveIntensity = 1.6; }
    return m;
  };
}
