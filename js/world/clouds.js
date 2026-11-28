// 구름층: 카메라를 향하는 반투명 사각형(빌보드)을 카메라 주변에 배치
import * as THREE from '../../vendor/three.module.min.js';

const CELL = 3000;          // 격자 간격 m
const RANGE = 14;           // ±RANGE 칸 (약 ±42km)

export class Clouds {
  constructor(scene) {
    this.max = (RANGE * 2 + 1) ** 2 * 2;
    const geo = new THREE.PlaneGeometry(1, 1);
    const inst = new THREE.InstancedBufferGeometry().copy(geo);
    inst.instanceCount = 0;
    this.off = new Float32Array(this.max * 4);         // x, y, z, size
    this.offAttr = new THREE.InstancedBufferAttribute(this.off, 4);
    inst.setAttribute('offset', this.offAttr);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: cloudTexture() }, color: { value: new THREE.Color(1, 1, 1) }, shade: { value: new THREE.Color(0.75, 0.78, 0.82) },
        fogFar: { value: 40000 }, fogColor: { value: new THREE.Color(0xc4dcef) }, opacity: { value: 0.9 } },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec4 offset; varying vec2 vUv; varying float vDist; varying float vY;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(offset.xyz, 1.0);
          mv.xy += position.xy * vec2(offset.w, offset.w * 0.45); vDist = -mv.z; vY = position.y;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <common>
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D map; uniform vec3 color; uniform vec3 shade; uniform float fogFar; uniform vec3 fogColor; uniform float opacity;
        varying vec2 vUv; varying float vDist; varying float vY;
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, vUv); if (t.a < 0.02) discard;
          vec3 c = mix(shade, color, clamp(vY + 0.6, 0.0, 1.0));
          float f = smoothstep(fogFar * 0.4, fogFar, vDist);
          float near = smoothstep(60.0, 400.0, vDist);
          gl_FragColor = vec4(mix(c, fogColor, f), t.a * opacity * (1.0 - f) * near); }`,
    });
    this.mesh = new THREE.Mesh(inst, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.geo = inst;
    this.key = '';
  }

  /** base/top(m MSL), cover(0~1). 카메라가 한 칸 이상 움직이면 다시 배치 */
  update(camPos, base, top, cover, fogFar, fogColor, tint) {
    if (base === null || cover <= 0) { this.geo.instanceCount = 0; return; }
    const ci = Math.round(camPos.x / CELL), cj = Math.round(camPos.z / CELL);
    const key = `${ci},${cj},${base},${top},${cover}`;
    this.mat.uniforms.fogFar.value = fogFar;
    this.mat.uniforms.fogColor.value.copy(fogColor);
    this.mat.uniforms.color.value.copy(tint.light); this.mat.uniforms.shade.value.copy(tint.dark);
    if (key === this.key) return;
    this.key = key;
    let n = 0;
    const thick = Math.max(150, top - base);
    for (let i = ci - RANGE; i <= ci + RANGE; i++) for (let j = cj - RANGE; j <= cj + RANGE; j++) {
      const h = hash(i, j);
      if (h > cover) continue;
      const puffs = cover > 0.85 ? 2 : 1;
      for (let k = 0; k < puffs; k++) {
        const r1 = hash(i * 7 + k, j * 3), r2 = hash(i * 5, j * 11 + k), r3 = hash(i + 91 * k, j - 17);
        const o = n * 4;
        this.off[o] = i * CELL + (r1 - 0.5) * CELL;
        this.off[o + 2] = j * CELL + (r2 - 0.5) * CELL;
        this.off[o + 1] = base + thick * (0.25 + r3 * 0.5);
        this.off[o + 3] = (cover > 0.85 ? 5200 : 2600) + r3 * 2600;
        n++;
      }
    }
    this.geo.instanceCount = n;
    this.offAttr.needsUpdate = true;
  }
}

function hash(i, j) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }

function cloudTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  for (let k = 0; k < 26; k++) {
    const cx = 40 + Math.random() * 176, cy = 50 + Math.random() * 40, r = 20 + Math.random() * 34;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
