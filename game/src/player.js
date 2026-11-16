// First-person controller: pointer-lock mouse look, WASD movement with
// acceleration and friction, crouch and a small jump, all colliding against
// the world's shared AABB list so the player and the bots play by one rule.

import * as THREE from 'three';
import { collideCircle } from './world.js';

export class Player {
  constructor(camera, dom, colliders) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(-30, 0, 2);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI / 2; // face east, into the yard
    this.pitch = 0;
    this.keys = new Set();
    this.crouching = false;
    this.eyeHeight = 1.62;
    this.grounded = true;
    this.locked = false;
    this.enabled = false;
    this.moveSpeedNow = 0;

    dom.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }
  lock() { this.dom.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }
  get eye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }
  update(dt) {
    const k = this.keys;
    const active = this.enabled;
    const fwd = active && k.has('KeyW') ? 1 : 0 - (active && k.has('KeyS') ? 1 : 0);
    const right = (active && k.has('KeyD') ? 1 : 0) - (active && k.has('KeyA') ? 1 : 0);
    this.crouching = active && (k.has('KeyC') || k.has('ControlLeft'));
    const walking = active && k.has('ShiftLeft');
    const maxSpeed = this.crouching ? 2.1 : walking ? 2.7 : 5.3;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward on the ground plane for yaw (three.js: -Z forward at yaw 0).
    const wish = new THREE.Vector3(
      -sin * fwd + cos * right,
      0,
      -cos * fwd - sin * right,
    );
    const wishLen = wish.length();
    if (wishLen > 0) wish.multiplyScalar(1 / wishLen);

    const accel = this.grounded ? 34 : 6;
    this.vel.x += wish.x * accel * dt;
    this.vel.z += wish.z * accel * dt;
    if (this.grounded) {
      const damp = Math.max(0, 1 - dt * 9);
      if (wishLen === 0) { this.vel.x *= damp; this.vel.z *= damp; }
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > maxSpeed) {
        this.vel.x *= maxSpeed / sp;
        this.vel.z *= maxSpeed / sp;
      }
      if (active && k.has('Space')) {
        this.vel.y = 4.7;
        this.grounded = false;
      }
    }
    this.vel.y -= 12.5 * dt;
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.grounded = true;
    }
    const [cx, cz] = collideCircle(this.colliders, this.pos.x, this.pos.z, 0.42);
    this.pos.x = THREE.MathUtils.clamp(cx, -37.4, 37.4);
    this.pos.z = THREE.MathUtils.clamp(cz, -37.4, 37.4);

    const targetEye = this.crouching ? 1.12 : 1.62;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);
    this.moveSpeedNow = Math.hypot(this.vel.x, this.vel.z);

    this.camera.position.copy(this.eye);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
