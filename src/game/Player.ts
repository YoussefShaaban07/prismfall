import * as THREE from 'three';
import type { Assets } from '../core/Assets';
import { addRim, heroMapper, type RimUniforms } from '../core/Assets';
import type { Input } from '../core/Input';
import { angleDiff, clamp, damp } from '../core/util';
import { ARENA_RADIUS, xpForLevel, type PassiveId, type WeaponId } from './data';
import { SHIPS, upLv, type MetaState, type ShipDef } from './meta';
import { Trail } from './Trails';

/** Kenney ships point down -Z in model space; rotate so +Z (our "forward") matches. */
export const SHIP_YAW = Math.PI;

export class Player {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  r = 0.75;
  ang = 0; // heading, radians; 0 = +Z
  bank = 0;
  hp = 100;
  maxHp = 100;
  inv = 0;
  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  speed = 9;
  magnet = 4;
  dmg = 1;
  cd = 1;
  area = 1;
  regen = 0;
  armor = 0;
  dashCD = 0;
  dashMax = 2.4;
  dashT = 0;
  dashX = 0;
  dashZ = 1;
  dead = false;
  hitWall = false;
  weapons = new Map<WeaponId, number>();
  passives = new Map<PassiveId, number>();
  evolved = new Set<WeaponId>();

  root = new THREE.Group();
  ship: THREE.Group;
  flames: THREE.Mesh[] = [];
  shield: THREE.Mesh;
  light: THREE.PointLight;
  magnetRing: THREE.Mesh;
  ghosts: { g: THREE.Group; t: number }[] = [];
  shipDef: ShipDef = SHIPS[0];
  xpMul = 1;
  revives = 0;
  private assets: Assets;
  private scene: THREE.Scene;
  /** holographic afterimage: bright fresnel edges, nearly clear faces, warming to white as it fades */
  private ghostMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0.3, 0.9, 1) }, uOp: { value: 0.5 }, uAge: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOp; uniform float uAge; varying vec3 vN; varying vec3 vV;
      void main(){
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
        vec3 c = mix(uColor * 1.6, vec3(1.4), uAge * 0.5);
        gl_FragColor = vec4(c * (0.06 + f * 1.15) * uOp, 1.0);
      }`,
  });
  private muzzle: THREE.Sprite;
  private muzzleT = 0;
  private ghostT = 0;
  trails: Trail[] = [];
  private trailW = 0.32;
  navLights: THREE.Mesh[] = [];
  private tv = new THREE.Vector3();

  constructor(scene: THREE.Scene, assets: Assets) {
    this.assets = assets;
    this.scene = scene;
    {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,255,255,.6)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = 'rgba(255,255,255,.9)';
      x.beginPath(); x.moveTo(0, 32); x.lineTo(32, 29); x.lineTo(64, 32); x.lineTo(32, 35); x.fill();
      x.beginPath(); x.moveTo(32, 0); x.lineTo(34, 32); x.lineTo(32, 64); x.lineTo(30, 32); x.fill();
      this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(0.7, 1, 1).multiplyScalar(1.6) }));
      this.muzzle.visible = false;
      this.muzzle.renderOrder = 6;
      scene.add(this.muzzle);
    }
    this.ship = assets.object('craft_speederA', 2.4, heroMapper(0x37e8ff, 0.9));
    this.hookHull();
    this.ship.rotation.y = SHIP_YAW;
    const holder = new THREE.Group();
    holder.add(this.ship);
    this.root.add(holder);
    this.root.userData.holder = holder;

    // engine flames
    const fGeo = new THREE.ConeGeometry(0.16, 1, 10, 1, true);
    fGeo.rotateX(-Math.PI / 2);
    fGeo.translate(0, 0, -0.5);
    const fMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 1).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const sx of [-0.42, 0.42]) {
      const f = new THREE.Mesh(fGeo, fMat);
      f.position.set(sx, 0.38, -1.0);
      holder.add(f);
      this.flames.push(f);
    }

    // dash / i-frame shield
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.55, 40, 20),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.95, 1) } },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uOpacity; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
          float hex(vec2 p){ p.x *= 1.1547; p.y += mod(floor(p.x), 2.0) * 0.5; p = abs(fract(p) - 0.5); return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0); }
          void main(){
            float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
            float hx = 1.0 - smoothstep(0.0, 0.1, hex(vec2(vUv.x * 24.0, vUv.y * 12.0 + uTime * 0.6)));
            float sweep = smoothstep(0.92, 1.0, sin(vUv.y * 18.0 - uTime * 7.0) * 0.5 + 0.5);
            float a = (f * 1.4 + hx * (0.18 + f) + sweep * 0.35) * uOpacity;
            gl_FragColor = vec4(uColor * a * 1.6, 1.0);
          }`,
      }),
    );
    this.shield.position.y = 0.5;
    this.root.add(this.shield);

    // magnet range indicator
    const mr = new THREE.RingGeometry(0.97, 1, 96);
    mr.rotateX(-Math.PI / 2);
    this.magnetRing = new THREE.Mesh(
      mr,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1, 0.85), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.magnetRing.position.y = 0.08;
    scene.add(this.magnetRing);

    this.light = new THREE.PointLight(0x4fe6ff, 4, 14, 1.6);
    this.light.position.y = 2.5;
    this.root.add(this.light);
    scene.add(this.root);

    this.buildGhosts();
    for (let i = 0; i < 2; i++) this.trails.push(new Trail(scene, 0x37e8ff, 0.32, 26, 0.016));
    // blinking navigation lights on the wingtips (red port, green starboard) and a white tail strobe
    const navGeo = new THREE.SphereGeometry(0.07, 8, 6);
    const navCols = [new THREE.Color(1, 0.1, 0.1).multiplyScalar(6), new THREE.Color(0.1, 1, 0.2).multiplyScalar(6), new THREE.Color(1, 1, 1).multiplyScalar(8)];
    const navPos = [[-1.05, 0.5, -0.3], [1.05, 0.5, -0.3], [0, 0.75, -1.0]];
    navCols.forEach((c, i) => {
      const m = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: c }));
      m.position.set(navPos[i][0], navPos[i][1], navPos[i][2]);
      holder.add(m);
      this.navLights.push(m);
    });
  }

  private buildGhosts() {
    for (const gh of this.ghosts) this.scene.remove(gh.g);
    this.ghosts = [];
    // dash afterimages share the ship geometry
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      g.add(inner);
      this.ship.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const gm = new THREE.Mesh(m.geometry, this.ghostMat.clone());
        m.updateWorldMatrix(true, false);
        gm.matrixAutoUpdate = false;
        gm.matrix.copy(m.matrix);
        inner.add(gm);
      });
      inner.scale.copy((this.ship.children[0] as THREE.Object3D).scale);
      g.visible = false;
      this.scene.add(g);
      this.ghosts.push({ g, t: 0 });
    }
  }

  /** Hull materials share the enemy damage shader (no rim): cracks open below half hull, hits flash. */
  private hullU: RimUniforms[] = [];
  private hookHull() {
    this.hullU = [];
    this.ship.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (!mat.isMeshStandardMaterial || mat.userData.rim) return;
      addRim(mat, 0xff4a1a, 0); // rim colour only tints the cracks (rim strength 0)
      this.hullU.push(mat.userData.rim as RimUniforms);
    });
  }
  /** dmg: 0 healthy → 1 nearly destroyed; flash: 0..1 hit flash */
  setHullLook(dmg: number, flash: number) {
    for (const u of this.hullU) {
      u.uDamage.value = dmg;
      u.uFlash.value = flash;
    }
  }

  setShip(def: ShipDef) {
    if (this.shipDef.id === def.id && this.ship.userData.built) return;
    this.shipDef = def;
    const holder = this.root.userData.holder as THREE.Group;
    holder.remove(this.ship);
    this.ship = this.assets.object(def.model, 2.4, heroMapper(def.accent, 0.9));
    this.hookHull();
    this.ship.rotation.y = SHIP_YAW;
    this.ship.userData.built = true;
    holder.add(this.ship);
    this.light.color.set(def.accent);
    ((this.shield.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).set(def.accent);
    for (const t of this.trails) t.setColor(def.accent);
    // each hull leaves its own wake: thin racing streaks, heavy gunboat plumes
    this.trailW = ({ comet: 0.32, wasp: 0.2, viper: 0.26, bastion: 0.55, phoenix: 0.42, prospector: 0.38 } as Record<string, number>)[def.id] ?? 0.32;
    for (const f of this.flames) (f.material as THREE.MeshBasicMaterial).color.set(def.accent).multiplyScalar(3);
    this.buildGhosts();
    for (const gh of this.ghosts) gh.g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) ((m.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).set(def.accent); });
    (this.muzzle.material as THREE.SpriteMaterial).color.set(def.accent).lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(1.6);
  }

  /** Star-shaped flash at the gun port, pointed along the shot. */
  flashMuzzle(a: number, size = 1) {
    const holder = this.root.userData.holder as THREE.Group;
    this.muzzle.position.set(this.x + Math.sin(a) * 1.25, holder.position.y + 0.05, this.z + Math.cos(a) * 1.25);
    this.muzzle.material.rotation = Math.random() * Math.PI;
    this.muzzleT = 0.07;
    this.muzzleS = size;
  }
  private muzzleS = 1;

  private spawnGhost() {
    const gh = this.ghosts.find((q) => q.t <= 0) ?? this.ghosts[0];
    gh.t = 0.3;
    gh.g.visible = true;
    const holder = this.root.userData.holder as THREE.Group;
    gh.g.position.set(this.x, holder.position.y, this.z);
    gh.g.rotation.set(0, this.ang + SHIP_YAW, 0);
  }

  private updateGhosts(dt: number) {
    for (const gh of this.ghosts) {
      if (gh.t <= 0) continue;
      gh.t -= dt;
      if (gh.t <= 0) { gh.g.visible = false; continue; }
      const life = gh.t / 0.3;
      gh.g.scale.setScalar(1 + (1 - life) * 0.14);
      gh.g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const u = (m.material as THREE.ShaderMaterial).uniforms;
        u.uOp.value = life * 0.5;
        u.uAge.value = 1 - life;
      });
    }
  }

  reset(meta: MetaState, def: ShipDef) {
    this.setShip(def);
    const hp = def.hp + upLv(meta, 'hull') * 10;
    Object.assign(this, {
      x: 0, z: 0, vx: 0, vz: 0, ang: 0, bank: 0, hp, maxHp: hp, inv: 0, level: 1, xp: 0,
      xpNext: xpForLevel(1),
      speed: 9 * def.speed * (1 + upLv(meta, 'thrusters') * 0.04),
      magnet: 4 * def.magnet * (1 + upLv(meta, 'tractor') * 0.12),
      dmg: 1 + upLv(meta, 'calib') * 0.05,
      cd: 1 - upLv(meta, 'reactor') * 0.03,
      area: def.area, regen: 0, armor: def.armor,
      dashCD: 0, dashMax: 2.4 * def.dash, dashT: 0, dead: false,
      xpMul: def.xp * (1 + upLv(meta, 'salvage') * 0.08),
      revives: upLv(meta, 'revive'),
    });
    this.weapons.clear();
    this.passives.clear();
    this.evolved.clear();
    this.weapons.set(def.weapon, 1);
    this.root.visible = true;
    this.ship.visible = true;
    for (const t of this.trails) t.reset();
  }

  get dashing() {
    return this.dashT > 0;
  }

  /** returns true if a dash started this frame */
  update(dt: number, input: Input, time: number): boolean {
    let dashed = false;
    if (this.dead) return false;
    this.inv = Math.max(0, this.inv - dt);
    this.dashCD = Math.max(0, this.dashCD - dt);
    if (this.regen > 0) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);

    const mx = input.moveX;
    const mz = input.moveY;
    const mlen = Math.hypot(mx, mz);
    if (input.consumeDash() && this.dashCD <= 0) {
      const dx = mlen > 0.1 ? mx / mlen : Math.sin(this.ang);
      const dz = mlen > 0.1 ? mz / mlen : Math.cos(this.ang);
      this.dashX = dx;
      this.dashZ = dz;
      this.dashT = 0.2;
      this.dashCD = this.dashMax;
      this.inv = Math.max(this.inv, 0.35);
      dashed = true;
    }

    this.updateGhosts(dt);
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      const k = Math.max(0, this.muzzleT / 0.07);
      this.muzzle.visible = k > 0;
      this.muzzle.scale.setScalar((1.2 + (1 - k) * 0.9) * this.muzzleS);
      this.muzzle.material.opacity = k;
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.04; this.spawnGhost(); }
      this.vx = this.dashX * this.speed * 3.6;
      this.vz = this.dashZ * this.speed * 3.6;
    } else {
      const tx = mx * this.speed;
      const tz = mz * this.speed;
      this.vx = damp(this.vx, tx, 12, dt);
      this.vz = damp(this.vz, tz, 12, dt);
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const R = ARENA_RADIUS - this.r - 0.3;
    const d = Math.hypot(this.x, this.z);
    if (d > R) {
      this.x *= R / d;
      this.z *= R / d;
      this.hitWall = true;
    } else this.hitWall = false;

    const sp = Math.hypot(this.vx, this.vz);
    let turn = 0;
    if (sp > 0.5) {
      const target = Math.atan2(this.vx, this.vz);
      turn = angleDiff(this.ang, target);
      this.ang += turn * Math.min(1, dt * 12);
    }
    this.bank = damp(this.bank, clamp(-turn * 1.2, -0.7, 0.7), 8, dt);
    this.visuals(dt, time, sp);
    return dashed;
  }

  /* ---------- co-op: downed ships wait on the ground for a teammate ---------- */
  private reviveRing: THREE.Mesh | null = null;
  private reviveFill: THREE.Mesh | null = null;
  /** Downed pose (slumped on the sand, engines out) plus a ring that fills as a teammate revives it. */
  setDowned(down: boolean, k: number) {
    if (!this.reviveRing) {
      const mk = (inner: number, op: number) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(inner, 1, 64).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1, 0.65).multiplyScalar(2), transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.position.y = 0.1;
        m.visible = false;
        this.scene.add(m);
        return m;
      };
      this.reviveRing = mk(0.94, 0.35);
      this.reviveFill = mk(0.0, 0.22);
    }
    const ring = this.reviveRing!, fill = this.reviveFill!;
    ring.visible = fill.visible = down;
    if (!down) return;
    const holder = this.root.userData.holder as THREE.Group;
    this.root.visible = true;
    this.root.position.set(this.x, 0, this.z);
    holder.position.y = 0.18;
    holder.rotation.set(0, this.ang, 0);
    this.ship.rotation.set(0.12, SHIP_YAW, 0.55);
    this.ship.visible = true;
    for (const f of this.flames) f.scale.set(1, 1, 0.01);
    this.shield.visible = false;
    for (const t of this.trails) t.visible = false;
    ring.position.set(this.x, 0.1, this.z);
    ring.scale.setScalar(3.5);
    fill.position.set(this.x, 0.11, this.z);
    fill.scale.setScalar(Math.max(0.01, 3.5 * k));
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(performance.now() / 180);
  }

  /* ---------- multiplayer puppet: a teammate's ship driven by network state ---------- */
  /** latest network state for a puppet */
  net = { x: 0, z: 0, vx: 0, vz: 0, ang: 0, t: 0, dash: false };
  /** Become a teammate's ship: no light (it would change every material's light count), no magnet ring, harmless guns. */
  makePuppet() {
    this.light.removeFromParent();
    this.magnetRing.visible = false;
    this.dmg = 0;
  }
  updatePuppet(dt: number, time: number) {
    if (this.dead) { this.updateGhosts(dt); return; }
    const n = this.net;
    // extrapolate from the last packet, then ease toward it so jitter never shows
    const age = Math.min(0.25, n.t);
    n.t += dt;
    const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
    const k = 1 - Math.exp(-14 * dt);
    if (Math.hypot(tx - this.x, tz - this.z) > 12) { this.x = tx; this.z = tz; }
    this.x += (tx - this.x) * k;
    this.z += (tz - this.z) * k;
    this.vx = n.vx;
    this.vz = n.vz;
    const turn = angleDiff(this.ang, n.ang);
    this.ang += turn * Math.min(1, dt * 12);
    this.bank = damp(this.bank, clamp(-turn * 1.2, -0.7, 0.7), 8, dt);
    this.inv = Math.max(0, this.inv - dt);
    if (n.dash && this.dashT <= 0) this.dashT = 0.2;
    if (this.dashT > 0) {
      this.dashT -= dt;
      this.ghostT -= dt;
      if (this.ghostT <= 0) { this.ghostT = 0.04; this.spawnGhost(); }
    }
    this.updateGhosts(dt);
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      const kk = Math.max(0, this.muzzleT / 0.07);
      this.muzzle.visible = kk > 0;
      this.muzzle.scale.setScalar((1.2 + (1 - kk) * 0.9) * this.muzzleS);
      this.muzzle.material.opacity = kk;
    }
    this.visuals(dt, time, Math.hypot(this.vx, this.vz));
    this.magnetRing.visible = false;
  }

  private visuals(dt: number, time: number, sp: number) {
    // visuals
    const holder = this.root.userData.holder as THREE.Group;
    this.root.position.set(this.x, 0, this.z);
    holder.rotation.set(0, this.ang, 0);
    holder.position.y = 0.55 + Math.sin(time * 3.2) * 0.12;
    this.ship.rotation.z = this.bank;
    this.ship.rotation.x = -Math.min(0.25, sp * 0.02);
    const thrust = 0.5 + Math.min(1, sp / this.speed) * 0.9 + (this.dashing ? 1.6 : 0);
    for (const f of this.flames) {
      f.scale.set(1, 1, thrust * (0.85 + Math.random() * 0.3));
    }
    const blink = (time * 1.2) % 1;
    this.navLights[0].visible = this.navLights[1].visible = blink < 0.55;
    this.navLights[2].visible = blink > 0.6 && blink < 0.66;
    const sm = this.shield.material as THREE.ShaderMaterial;
    sm.uniforms.uOpacity.value = damp(sm.uniforms.uOpacity.value as number, this.inv > 0 ? 0.8 : 0, 14, dt);
    sm.uniforms.uTime.value = time;
    this.shield.visible = (sm.uniforms.uOpacity.value as number) > 0.01;
    this.shield.rotation.y += dt * 2;
    this.shield.rotation.x += dt * 1.3;
    // blink on damage i-frames (not dash)
    this.ship.visible = !(this.inv > 0 && !this.dashing && Math.floor(time * 20) % 2 === 0);
    this.magnetRing.position.set(this.x, 0.08, this.z);
    // engine ribbons from both nozzles
    this.root.updateMatrixWorld(true);
    this.trails.forEach((t, i) => {
      this.flames[i].getWorldPosition(this.tv);
      t.intensity = this.dashing ? 1.1 : 0.3 + Math.min(1, sp / this.speed) * 0.6;
      t.width = this.dashing ? this.trailW * 2.2 : this.trailW;
      t.visible = this.root.visible;
      t.update(dt, this.tv);
    });
    this.magnetRing.scale.setScalar(this.magnet);
  }
}
