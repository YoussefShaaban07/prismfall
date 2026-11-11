import * as THREE from 'three';
import type { WeaponId, PassiveId } from '../game/data';

/**
 * Renders small 3D icons for every weapon and module once at startup,
 * using a throwaway WebGL renderer, and returns them as data URLs for the UI.
 */
type IconId = WeaponId | PassiveId | 'heal' | 'bounty';

function glowMat(color: number, k = 1.2) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.25, metalness: 0.5, flatShading: true });
}
function darkMat() {
  return new THREE.MeshStandardMaterial({ color: 0x2a2638, roughness: 0.4, metalness: 0.7, flatShading: true });
}

function build(id: IconId, color: number): THREE.Object3D {
  const g = new THREE.Group();
  const C = glowMat(color);
  switch (id) {
    case 'blaster': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.6, 6), darkMat());
      body.rotation.z = Math.PI / 2;
      g.add(body);
      for (let i = 0; i < 3; i++) {
        const bolt = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.7, 4, 8), C);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(1.3 + i * 0.25, (i - 1) * 0.35, 0);
        g.add(bolt);
      }
      break;
    }
    case 'blades': {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), darkMat()));
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), C);
        b.scale.set(0.35, 0.25, 1.2);
        const a = (i / 4) * Math.PI * 2;
        b.position.set(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0);
        b.rotation.z = a;
        g.add(b);
      }
      break;
    }
    case 'arc': {
      const pts = [[-1.2, 0.9], [-0.3, 0.2], [-0.6, -0.1], [0.5, -0.6], [0.2, -0.3], [1.2, -1]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.16), C);
        seg.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
        seg.rotation.z = Math.atan2(y2 - y1, x2 - x1);
        g.add(seg);
      }
      break;
    }
    case 'missiles': {
      for (let i = 0; i < 3; i++) {
        const m = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 8), darkMat());
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 8), C);
        tip.position.y = 0.75;
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 8), glowMat(0xff7a1a, 2));
        flame.rotation.x = Math.PI;
        flame.position.y = -0.8;
        m.add(body, tip, flame);
        m.position.set((i - 1) * 0.6, (i === 1 ? 0.25 : -0.1), 0);
        m.rotation.z = -0.5 + (i - 1) * -0.1;
        g.add(m);
      }
      break;
    }
    case 'nova': {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), C));
      for (let i = 0; i < 2; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.85 + i * 0.4, 0.07, 6, 48), glowMat(color, 1.6 - i * 0.6));
        r.rotation.x = 0.35 + i * 0.5;
        g.add(r);
      }
      break;
    }
    case 'lance': {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.8, 10), glowMat(color, 1.8));
      beam.rotation.z = Math.PI / 2 + 0.4;
      g.add(beam);
      const emit = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), darkMat());
      emit.position.set(-1.2, -0.55, 0);
      g.add(emit);
      break;
    }
    case 'wingmen': {
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 3), i === 0 ? darkMat() : C);
        s.rotation.z = -Math.PI / 2;
        s.position.set(i === 0 ? 0.5 : -0.3, i === 0 ? 0 : (i === 1 ? 0.6 : -0.6), 0);
        g.add(s);
      }
      break;
    }
    case 'mines': {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), darkMat()));
      for (let i = 0; i < 6; i++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 6), C);
        const a = (i / 6) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0);
        sp.rotation.z = a - Math.PI / 2;
        g.add(sp);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.04, 6, 48), glowMat(color, 1.4));
      ring.rotation.x = 0.5;
      g.add(ring);
      break;
    }
    case 'vitality':
    case 'heal': {
      const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 0.45), C);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), C);
      g.add(a, b);
      break;
    }
    case 'thrust': {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.8, 10), darkMat());
      n.rotation.z = Math.PI / 2;
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.4, 10), glowMat(color, 2));
      f.rotation.z = Math.PI / 2;
      f.position.x = -1.05;
      g.add(n, f);
      break;
    }
    case 'magnet': {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.25, 8, 24, Math.PI), darkMat());
      m.rotation.z = Math.PI;
      g.add(m);
      for (const sx of [-0.75, 0.75]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), C);
        tip.position.set(sx, 0.2, 0);
        g.add(tip);
      }
      break;
    }
    case 'power':
    case 'bounty': {
      g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), C));
      break;
    }
    case 'clock': {
      const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.3, 12), darkMat());
      gear.rotation.x = Math.PI / 2;
      g.add(gear);
      for (let i = 0; i < 12; i++) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.3), C);
        const a = (i / 12) * Math.PI * 2;
        t.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0);
        t.rotation.z = a;
        g.add(t);
      }
      break;
    }
    case 'regen': {
      for (let i = 0; i < 5; i++) {
        const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), C);
        const a = (i / 5) * Math.PI * 2;
        c.position.set(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0);
        g.add(c);
      }
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), darkMat()));
      break;
    }
    case 'area': {
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.4, 0.07, 6, 6), glowMat(color, 1.6 - i * 0.4));
        g.add(r);
      }
      break;
    }
    case 'armor': {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.35, 6), C);
      h.rotation.x = Math.PI / 2;
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.5, 6), darkMat());
      inner.rotation.x = Math.PI / 2;
      g.add(h, inner);
      break;
    }
  }
  return g;
}

export function renderIcons(defs: { id: IconId; color: string }[], size = 128): Map<string, string> {
  const out = new Map<string, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 0.6, 6.2);
  cam.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xbfdfff, 0x302040, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 4);
  scene.add(key);
  for (const d of defs) {
    const col = new THREE.Color(d.color).getHex();
    const inner = build(d.id, col);
    inner.rotation.set(0.35, -0.5, 0);
    // auto-fit: centre the model and scale it to fill the frame
    const box = new THREE.Box3().setFromObject(inner);
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    inner.position.sub(c);
    const obj = new THREE.Group();
    obj.add(inner);
    obj.scale.setScalar(2.6 / Math.max(sz.x, sz.y, 0.01));
    scene.add(obj);
    renderer.render(scene, cam);
    out.set(d.id, renderer.domElement.toDataURL('image/png'));
    scene.remove(obj);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
