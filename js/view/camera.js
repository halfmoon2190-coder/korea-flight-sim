// 시점: 조종석 / 추적 / 외부(마우스 회전) / 관제탑
import * as THREE from '../../vendor/three.module.min.js';
import { AC } from '../sim/a320.js';

export const VIEWS = [
  { id: 'cockpit', name: '조종석' },
  { id: 'chase', name: '추적' },
  { id: 'orbit', name: '외부 (마우스로 회전)' },
  { id: 'tower', name: '관제탑' },
];

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.view = 'cockpit';
    this.look = { yaw: 0, pitch: -7 };     // 조종석 시선 (도)
    this.orbit = { yaw: 200, pitch: 12, dist: 70 };
    this.chasePos = null;
    this.towerPos = new THREE.Vector3(0, 100, 0);
    this.drag = null;
    dom.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.button === 2) { this.drag = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); } });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      if (this.view === 'cockpit') {
        this.look.yaw = THREE.MathUtils.clamp(this.look.yaw - dx * 0.2, -160, 160);
        this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - dy * 0.2, -60, 50);
      } else if (this.view === 'orbit' || this.view === 'chase') {
        this.view = 'orbit';
        this.orbit.yaw -= dx * 0.3; this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.2, -10, 85);
      }
    });
    dom.addEventListener('pointerup', () => { this.drag = null; });
    dom.addEventListener('dblclick', () => { this.look = { yaw: 0, pitch: -7 }; });
    dom.addEventListener('wheel', (e) => {
      if (this.view === 'orbit') this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9), 25, 600);
      if (this.view === 'cockpit') this.cam.fov = THREE.MathUtils.clamp(this.cam.fov + (e.deltaY > 0 ? 3 : -3), 35, 85);
      this.cam.updateProjectionMatrix();
    }, { passive: true });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  next() {
    const i = VIEWS.findIndex(v => v.id === this.view);
    this.set(VIEWS[(i + 1) % VIEWS.length].id);
    return VIEWS.find(v => v.id === this.view).name;
  }
  set(id) {
    this.view = id;
    this.chasePos = null;
    this.cam.fov = id === 'cockpit' ? 62 : 55;
    this.cam.near = id === 'cockpit' ? 0.3 : 1.0;
    this.cam.updateProjectionMatrix();
  }

  update(ac, model, dt) {
    const cam = this.cam;
    model.root.visible = this.view !== 'cockpit';
    if (this.view === 'cockpit') {
      const eye = new THREE.Vector3(...AC.cockpitEye).applyQuaternion(ac.q).add(ac.pos);
      cam.position.copy(eye);
      const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.pitch * Math.PI / 180, this.look.yaw * Math.PI / 180, 0, 'YXZ'));
      cam.quaternion.copy(ac.q).multiply(lq);
    } else if (this.view === 'chase') {
      // 기수 방향(수평) 뒤쪽 위에서 부드럽게 따라감
      const h = ac.heading * Math.PI / 180;
      const back = new THREE.Vector3(-Math.sin(h), 0, Math.cos(h));
      const target = ac.pos.clone().addScaledVector(back, 75).add(new THREE.Vector3(0, 20, 0));
      if (!this.chasePos) this.chasePos = target.clone();
      this.chasePos.lerp(target, 1 - Math.exp(-dt * 3));
      cam.position.copy(this.chasePos);
      cam.lookAt(ac.pos.clone().add(new THREE.Vector3(0, -22, 0)).addScaledVector(back, -30));   // 기체가 화면 중앙보다 약간 위에 오도록
    } else if (this.view === 'orbit') {
      const y = this.orbit.yaw * Math.PI / 180, p = this.orbit.pitch * Math.PI / 180, d = this.orbit.dist;
      const h = ac.heading * Math.PI / 180;
      const off = new THREE.Vector3(Math.sin(h + y) * Math.cos(p) * d, Math.sin(p) * d, -Math.cos(h + y) * Math.cos(p) * d);
      cam.position.copy(ac.pos).add(off);
      if (cam.position.y < 2) cam.position.y = 2;
      cam.lookAt(ac.pos);
    } else if (this.view === 'tower') {
      cam.position.copy(this.towerPos);
      cam.lookAt(ac.pos);
      const dist = cam.position.distanceTo(ac.pos);
      cam.fov = THREE.MathUtils.clamp(2 * Math.atan(70 / dist) * 180 / Math.PI, 2, 55);
      cam.updateProjectionMatrix();
    }
  }
}
