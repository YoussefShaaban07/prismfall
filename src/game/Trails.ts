import * as THREE from 'three';

/**
 * Flat ribbon trail that follows a moving point, fading and tapering toward the tail.
 * One draw call per trail; geometry is rewritten in place each frame.
 */
export class Trail {
  mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private pos: Float32Array;
  private alpha: Float32Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private acc = 0;
  width: number;
  intensity = 1;

  constructor(scene: THREE.Scene, color: THREE.ColorRepresentation, width = 0.4, private n = 28, private step = 0.016) {
    this.width = width;
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uK: { value: 1 } },
      vertexShader: /* glsl */ `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uK; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA * uK * 1.3, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  setColor(c: THREE.ColorRepresentation) {
    (this.mat.uniforms.uColor.value as THREE.Color).set(c);
  }

  reset(p?: THREE.Vector3) {
    this.pts.length = 0;
    if (p) for (let i = 0; i < this.n; i++) this.pts.push(p.clone());
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  update(dt: number, head: THREE.Vector3) {
    if (this.pts.length === 0) this.reset(head);
    this.acc += dt;
    while (this.acc >= this.step) {
      this.acc -= this.step;
      const last = this.pts.pop()!;
      last.copy(head);
      this.pts.unshift(last);
    }
    this.pts[0].copy(head);
    this.mat.uniforms.uK.value = this.intensity;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const q = this.pts[Math.min(n - 1, i + 1)];
      const r = this.pts[Math.max(0, i - 1)];
      let dx = r.x - q.x, dz = r.z - q.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const t = i / (n - 1);
      const w = this.width * (1 - t) * 0.5;
      const k = i * 6;
      this.pos[k] = p.x - dz * w; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z + dx * w;
      this.pos[k + 3] = p.x + dz * w; this.pos[k + 4] = p.y; this.pos[k + 5] = p.z - dx * w;
      const a = Math.pow(1 - t, 1.6);
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
