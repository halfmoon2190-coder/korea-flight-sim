// 3D 경로 가이드: 계획 경로(고도 포함)를 따라 고리(링)와 선을 그림
import * as THREE from '../../vendor/three.module.min.js';

const NM = 1852;
const AHEAD = 14;           // 앞쪽에 보여줄 링 개수
const SPACING = 0.5 * NM;   // 링 간격

export class RouteGuide {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    const torus = new THREE.TorusGeometry(70, 3.5, 6, 28);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xff4fe0, transparent: true, opacity: 0.85, fog: false });
    this.rings = new THREE.InstancedMesh(torus, this.mat, AHEAD);
    this.rings.frustumCulled = false;
    this.group.add(this.rings);
    this.line = null;
    this.pts = [];
    this.enabled = true;
  }

  setPlan(plan) {
    this.plan = plan;
    if (this.line) { this.group.remove(this.line); this.line.geometry.dispose(); this.line = null; }
    if (!plan) { this.pts = []; return; }
    this.pts = plan.samplePath(SPACING);
    // 전체 경로 선 (기준점: 첫 점, 큰 좌표 정밀도 보호)
    const o = this.pts[0];
    const arr = new Float32Array(this.pts.length * 3);
    this.pts.forEach((p, i) => { arr[i * 3] = p.x - o.x; arr[i * 3 + 1] = p.alt; arr[i * 3 + 2] = p.z - o.z; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff4fe0, transparent: true, opacity: 0.55, fog: false }));
    this.line.position.set(o.x, 0, o.z);
    this.line.frustumCulled = false;
    this.group.add(this.line);
  }

  update(ac, sNow, show) {
    const vis = show && this.enabled && this.pts.length > 1 && !ac.wow;
    this.group.visible = vis;
    if (!vis) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 0, 1);
    const pos = new THREE.Vector3(), dir = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let k = 0;
    const i0 = Math.max(0, Math.ceil((sNow + 300) / SPACING));
    for (let i = i0; i < this.pts.length - 1 && k < AHEAD; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      pos.set(a.x, a.alt + 2.9, a.z);
      dir.set(b.x - a.x, b.alt - a.alt, b.z - a.z).normalize();
      q.setFromUnitVectors(up, dir);
      // 가까운 링은 조금 작게(통과 느낌), 먼 링은 크게(잘 보이도록)
      const d = pos.distanceTo(ac.pos);
      const s = Math.min(2.2, Math.max(0.8, d / 4000));
      sc.set(s, s, s);
      m.compose(pos, q, sc);
      this.rings.setMatrixAt(k++, m);
    }
    this.rings.count = k;
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
