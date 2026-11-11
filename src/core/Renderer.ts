import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

export type Quality = 'ultra' | 'high' | 'low';

/** Final grading: vignette, chromatic aberration on hits, film grain, scanline shimmer. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uHurt: { value: 0 },
    uAberr: { value: 0 },
    uVignette: { value: 1 },
    uSat: { value: 1.12 },
    uShadowTint: { value: new THREE.Vector3(-0.02, 0.03, 0.06) },
    uHighTint: { value: new THREE.Vector3(0.05, 0.02, -0.03) },
    uContrast: { value: 1.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uHurt; uniform float uAberr; uniform float uVignette; uniform float uSat; uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uContrast;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * (0.0005 + uAberr * 0.007) * d * 2.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(l), col, uSat);
      // cinematic split-toning: cool shadows, warm highlights, gentle S-curve
      col += uShadowTint * pow(1.0 - clamp(l, 0.0, 1.0), 2.0) + uHighTint * pow(clamp(l, 0.0, 1.0), 2.0);
      col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 10.0);
      float vig = smoothstep(0.95, 0.25, d * uVignette);
      col *= mix(0.55, 1.0, vig);
      col = mix(col, col * vec3(1.4,0.5,0.5) + vec3(0.1,0.0,0.0), uHurt * (1.0 - vig*0.85));
      col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Screen-space heat ripples for explosions and shockwaves (up to 8 at once). */
const DistortShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uWaves: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec4 uWaves[8]; uniform float uAspect; varying vec2 vUv;
    void main(){
      vec2 off = vec2(0.0);
      float glow = 0.0;
      for (int i = 0; i < 8; i++) {
        vec4 w = uWaves[i];
        if (w.w <= 0.0) continue;
        vec2 d = vUv - w.xy;
        d.x *= uAspect;
        float dist = length(d);
        float band = w.z * 0.18 + 0.01;
        float ring = exp(-pow((dist - w.z) / band, 2.0));
        off += (d / max(dist, 1e-4)) * ring * w.w * 0.03 * vec2(1.0 / uAspect, 1.0);
        glow += ring * w.w;
      }
      vec3 col = texture2D(tDiffuse, vUv - off).rgb;
      col += vec3(1.0, 0.9, 0.8) * glow * 0.04;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Screen-space light shafts: radial blur of bright sky pixels toward the sun. */
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uTint: { value: new THREE.Color(1.0, 0.7, 0.45) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (uStrength <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 dir = (uSun - vUv) / 28.0;
      vec2 p = vUv;
      float decay = 1.0, acc = 0.0;
      for (int i = 0; i < 28; i++) {
        p += dir;
        vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
        float l = max(0.0, dot(s, vec3(0.3, 0.5, 0.2)) - 0.55);
        acc += l * decay;
        decay *= 0.94;
      }
      gl_FragColor = vec4(base + uTint * acc * uStrength * 0.09, 1.0);
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  distort: ShaderPass;
  gtao: GTAOPass | null = null;
  bokeh: BokehPass;
  shafts: ShaderPass;
  smaa: SMAAPass | null = null;
  fxaa: ShaderPass;
  /** Dynamic resolution: multiplier on the quality's pixel ratio, driven by measured GPU time. */
  renderScale = 1;
  private basePR = 1;
  /** GTAO buffers relative to the main target (half on HIGH: AO is low-frequency anyway). */
  private aoScale = 0.5;
  quality: Quality = 'high';
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  width = 1;
  height = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false; // count draws across the whole post chain per frame

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 1200);
    this.scene.background = new THREE.Color(0x1a0d12);
    this.scene.fog = new THREE.Fog(0x7a4a40, 90, 520);

    // lights: warm low sun (Mars dusk) + cool sky fill
    this.hemi = new THREE.HemisphereLight(0x9fb8ff, 0x4a2116, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc29a, 2.0);
    this.sun.position.set(-30, 45, 18);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    try {
      this.gtao = new GTAOPass(this.scene, this.camera, 512, 512);
      this.gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.2, thickness: 4, scale: 1.3, samples: 12, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.gtao.blendIntensity = 0.9;
      const gtaoSetSize = this.gtao.setSize.bind(this.gtao);
      this.gtao.setSize = (w: number, h: number) => gtaoSetSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale)));
      // AO should only see solid, lit geometry: hide FX (particles, additive/transparent meshes, sky) while it renders
      const gtao = this.gtao;
      const baseRender = gtao.render.bind(gtao);
      const hidden: THREE.Object3D[] = [];
      gtao.render = (renderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
        this.scene.traverseVisible((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          const fx = (o as THREE.Points).isPoints || (o as THREE.Line).isLine ||
            (m && (m.transparent || !m.depthWrite || (m as THREE.MeshBasicMaterial).isMeshBasicMaterial || (m as THREE.ShaderMaterial).isShaderMaterial));
          if (fx && o.visible && !(o as THREE.Light).isLight) {
            o.visible = false;
            hidden.push(o);
          }
        });
        baseRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
        for (const o of hidden) o.visible = true;
        hidden.length = 0;
      };
      this.composer.addPass(this.gtao);
    } catch {
      this.gtao = null;
    }
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 11, aperture: 0.0005, maxblur: 0.006 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    this.distort = new ShaderPass(DistortShader);
    this.composer.addPass(this.distort);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 1.0);
    this.composer.addPass(this.bloom);
    this.shafts = new ShaderPass(ShaftShader);
    this.composer.addPass(this.shafts);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    try {
      this.smaa = new SMAAPass();
      this.composer.addPass(this.smaa);
    } catch {
      this.smaa = null;
    }
    // FXAA: one cheap tap pattern for HIGH; SMAA's three passes cost ~6x more on integrated GPUs
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.enabled = false;
    this.composer.addPass(this.fxaa);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    // HIGH caps at 1.25 so a 1080p laptop panel at 150% scaling doesn't push 2.25x the pixels
    this.basePR = q === 'ultra' ? Math.min(dpr, 2) : q === 'high' ? Math.min(dpr, 1.25) : Math.min(dpr, 1);
    this.aoScale = q === 'ultra' ? 1 : 0.5;
    if (this.gtao) {
      this.gtao.updateGtaoMaterial({ samples: q === 'ultra' ? 16 : 8 });
      this.gtao.updatePdMaterial({ samples: q === 'ultra' ? 16 : 6, rings: 2 });
    }
    this.applyPR();
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const ms = q === 'ultra' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
    if (this.smaa) this.smaa.enabled = q === 'ultra';
    this.fxaa.enabled = q === 'high' || (q === 'ultra' && !this.smaa);
    if (this.gtao) this.gtao.enabled = q !== 'low';
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  /** Change the dynamic-resolution multiplier (clamped); reallocates targets only when it really moves. */
  setRenderScale(s: number) {
    const v = Math.max(0.5, Math.min(1, s));
    if (Math.abs(v - this.renderScale) < 0.01) return;
    this.renderScale = v;
    this.applyPR();
  }

  private applyPR() {
    const pr = this.basePR * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.resize();
  }

  /** Real pixels of the drawing buffer (for FXAA and anything that needs texel size). */
  private syncFxaa() {
    const pr = this.renderer.getPixelRatio();
    (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / Math.max(1, this.width * pr), 1 / Math.max(1, this.height * pr));
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this.camera.aspect = this.width / this.height;
    if (this.distort) this.distort.uniforms.uAspect.value = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.fxaa) this.syncFxaa();
  }

  /** world-units-per-pixel helper for point sprites */
  pointScale() {
    const h = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    return h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /* ---------- GPU timing (EXT_disjoint_timer_query_webgl2) ---------- */
  private tq: { ext: any; gl: WebGL2RenderingContext; pending: WebGLQuery[] } | null = null;
  private tqTried = false;
  /** Smoothed GPU milliseconds per frame, or -1 when the browser can't measure it. */
  gpuMs = -1;

  private beginTimer() {
    if (!this.tqTried) {
      this.tqTried = true;
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const ext = (gl as any).getExtension?.('EXT_disjoint_timer_query_webgl2');
      if (ext && 'createQuery' in gl) this.tq = { ext, gl, pending: [] };
    }
    const t = this.tq;
    if (!t) return null;
    // harvest finished queries (results arrive a few frames late)
    while (t.pending.length) {
      const q = t.pending[0];
      if (!t.gl.getQueryParameter(q, t.gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = t.gl.getParameter(t.ext.GPU_DISJOINT_EXT);
      const ms = (t.gl.getQueryParameter(q, t.gl.QUERY_RESULT) as number) / 1e6;
      t.gl.deleteQuery(q);
      t.pending.shift();
      if (!disjoint && ms > 0 && ms < 500) this.gpuMs = this.gpuMs < 0 ? ms : this.gpuMs + (ms - this.gpuMs) * 0.08;
    }
    if (t.pending.length > 6) return null; // driver is far behind; don't pile up queries
    const q = t.gl.createQuery();
    if (!q) return null;
    t.gl.beginQuery(t.ext.TIME_ELAPSED_EXT, q);
    t.pending.push(q);
    return t;
  }

  render(time: number) {
    this.grade.uniforms.uTime.value = time % 100;
    const t = this.beginTimer();
    this.renderer.info.reset();
    this.composer.render();
    if (t) t.gl.endQuery(t.ext.TIME_ELAPSED_EXT);
  }
}
