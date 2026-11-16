// Weapons and sound. Four guns with distinct handling — the pistol you start
// with, a fast SMG, a precise longarm and a pump scattergun — all hitscan,
// all with spread that punishes movement and spraying. Every sound is
// synthesized with WebAudio: no audio files, nothing fetched.

import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', price: 0, slot: 1,
    damage: 27, headMult: 2.4, interval: 0.24, auto: false,
    mag: 12, reserve: 60, reloadTime: 1.05,
    spread: 0.006, spreadBloom: 0.006, spreadMove: 0.016,
    pellets: 1, kick: 0.010, tracer: 0xffd9a0,
  },
  smg: {
    id: 'smg', name: 'Raptor SMG', price: 900, slot: 2,
    damage: 19, headMult: 2.0, interval: 0.075, auto: true,
    mag: 30, reserve: 120, reloadTime: 1.7,
    spread: 0.014, spreadBloom: 0.006, spreadMove: 0.024,
    pellets: 1, kick: 0.012, tracer: 0xffe9b0,
  },
  scatter: {
    id: 'scatter', name: 'Mule 12G', price: 1100, slot: 3,
    damage: 9, headMult: 1.6, interval: 0.95, auto: false,
    mag: 6, reserve: 30, reloadTime: 2.3,
    spread: 0.045, spreadBloom: 0.0, spreadMove: 0.05,
    pellets: 7, kick: 0.035, tracer: 0xffc37a,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Longarm', price: 2400, slot: 4,
    damage: 34, headMult: 2.6, interval: 0.115, auto: true,
    mag: 25, reserve: 100, reloadTime: 1.9,
    spread: 0.004, spreadBloom: 0.009, spreadMove: 0.02,
    pellets: 1, kick: 0.018, tracer: 0xc8f4ff,
  },
};
export const BUY_ORDER = ['smg', 'scatter', 'rifle'];
export const ARMOR_PRICE = 650;

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }
  ready() { return this.ctx && this.ctx.state === 'running'; }
  noise(dur, freq, gain, type = 'lowpass', sweepTo = null) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  blip(freq, dur, gain, type = 'square', slideTo = null) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  shot(id, vol = 1) {
    if (id === 'pistol') { this.noise(0.09, 2600, 0.5 * vol); this.blip(160, 0.07, 0.25 * vol, 'square', 60); }
    else if (id === 'smg') { this.noise(0.06, 3400, 0.38 * vol); this.blip(200, 0.05, 0.18 * vol, 'square', 80); }
    else if (id === 'rifle') { this.noise(0.13, 1900, 0.55 * vol); this.blip(120, 0.1, 0.3 * vol, 'sawtooth', 45); }
    else if (id === 'scatter') { this.noise(0.28, 1200, 0.8 * vol, 'lowpass', 200); this.blip(90, 0.16, 0.35 * vol, 'sawtooth', 40); }
  }
  dryFire() { this.blip(900, 0.04, 0.12, 'square'); }
  reloadStart() { this.blip(500, 0.05, 0.15, 'square'); setTimeout(() => this.blip(320, 0.05, 0.15, 'square'), 160); }
  reloadEnd() { this.blip(700, 0.05, 0.18, 'square'); setTimeout(() => this.blip(1050, 0.06, 0.2, 'square'), 90); }
  hit(kill) {
    if (kill) {
      // Kill confirm: a falling two-tone chirp plus a low thump, clearly
      // distinct from the plain hit tick so a kill registers by ear alone.
      this.blip(880, 0.09, 0.24, 'sine', 660);
      setTimeout(() => this.blip(587, 0.14, 0.24, 'sine', 392), 55);
      this.noise(0.12, 500, 0.18, 'lowpass', 120);
    } else {
      this.blip(1150, 0.06, 0.2, 'sine', 900);
      this.noise(0.03, 4000, 0.07, 'highpass');
    }
  }
  headshot() { this.blip(1560, 0.07, 0.2, 'square', 1180); }
  hurt() { this.blip(140, 0.12, 0.2, 'sawtooth', 70); this.noise(0.08, 700, 0.12, 'lowpass', 200); }
  beep(final = false) { this.blip(final ? 1560 : 980, final ? 0.3 : 0.09, 0.2, 'sine'); }
  explosion() {
    this.noise(1.1, 900, 1.0, 'lowpass', 60);
    this.blip(70, 0.8, 0.5, 'sine', 30);
  }
  sting(win) {
    const notes = win ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 0.2, 'triangle'), i * 130));
  }
  buy() { this.blip(880, 0.07, 0.18, 'sine'); setTimeout(() => this.blip(1320, 0.09, 0.18, 'sine'), 70); }
}

const GUN_MATS = {
  body: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x8a5a20, roughness: 0.6, metalness: 0.3 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.9 }),
};

function gunModel(id) {
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, mat = GUN_MATS.body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  if (id === 'pistol') {
    add(0.055, 0.09, 0.24, 0, 0, -0.1);
    add(0.045, 0.13, 0.07, 0, -0.1, 0.0, GUN_MATS.grip);
    add(0.02, 0.035, 0.02, 0, 0.065, -0.19);
  } else if (id === 'smg') {
    add(0.06, 0.1, 0.42, 0, 0, -0.16);
    add(0.05, 0.16, 0.06, 0, -0.12, -0.1, GUN_MATS.grip);
    add(0.045, 0.05, 0.2, 0, 0.075, -0.14);
    add(0.03, 0.03, 0.16, 0, 0.01, -0.44);
  } else if (id === 'scatter') {
    add(0.07, 0.09, 0.52, 0, 0, -0.2);
    add(0.055, 0.12, 0.09, 0, -0.09, 0.04, GUN_MATS.accent);
    add(0.06, 0.05, 0.18, 0, -0.055, -0.3, GUN_MATS.accent);
    add(0.035, 0.035, 0.3, 0, 0.03, -0.42);
  } else {
    add(0.06, 0.1, 0.58, 0, 0, -0.24);
    add(0.05, 0.17, 0.055, 0, -0.12, -0.12, GUN_MATS.grip);
    add(0.04, 0.06, 0.3, 0, 0.08, -0.2);
    add(0.028, 0.028, 0.24, 0, 0.005, -0.62);
    add(0.02, 0.05, 0.02, 0, 0.1, -0.5);
  }
  return g;
}

export class WeaponRig {
  constructor(camera) {
    this.group = new THREE.Group();
    this.group.position.set(0.27, -0.245, -0.45);
    camera.add(this.group);
    this.models = {};
    for (const id of Object.keys(WEAPONS)) {
      const model = gunModel(id);
      model.visible = false;
      this.group.add(model);
      this.models[id] = model;
    }
    // Muzzle flash: two crossed planes so the star reads from any roll.
    this.flash = new THREE.Group();
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const rz of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.15), flashMat);
      p.rotation.z = rz;
      this.flash.add(p);
    }
    const tongue = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.34), flashMat);
    tongue.rotation.x = Math.PI / 2;
    tongue.position.z = -0.1;
    this.flash.add(tongue);
    this.flashMat = flashMat;
    this.flash.position.set(0, 0.02, -0.85);
    this.group.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb36b, 0, 9, 2);
    this.flashLight.position.set(0, 0, -0.8);
    this.group.add(this.flashLight);

    this.current = 'pistol';
    this.ammo = {};
    for (const [id, w] of Object.entries(WEAPONS)) this.ammo[id] = { mag: w.mag, reserve: w.reserve };
    this.nextShotAt = 0;
    this.reloadUntil = 0;
    this.bloom = 0;
    this.kickPitch = 0;
    this.kickYaw = 0;
    this.bobT = 0;
    this.switchUntil = 0;
    this.show('pistol');
  }
  def() { return WEAPONS[this.current]; }
  state(id = this.current) { return this.ammo[id]; }
  show(id) {
    this.current = id;
    for (const [k, m] of Object.entries(this.models)) m.visible = k === id;
  }
  equip(id, now) {
    if (id === this.current || !this.ammo[id]) return;
    this.show(id);
    this.reloadUntil = 0;
    this.switchUntil = now + 0.28;
    this.group.position.y = -0.42;
  }
  canFire(now) {
    return now >= this.nextShotAt && now >= this.switchUntil && now >= this.reloadUntil && this.ammo[this.current].mag > 0;
  }
  isReloading(now) { return now < this.reloadUntil; }
  fire(now) {
    const w = this.def();
    this.ammo[this.current].mag -= 1;
    this.nextShotAt = now + w.interval;
    this.bloom = Math.min(0.05, this.bloom + w.spreadBloom);
    this.kickPitch += w.kick;
    this.kickYaw += (Math.random() - 0.5) * w.kick * 1.3;
    this.flashMat.opacity = 0.95;
    this.flash.rotation.z = Math.random() * Math.PI;
    const fs = 0.8 + Math.random() * 0.55;
    this.flash.scale.set(fs, fs, fs);
    this.flashLight.intensity = 14;
    this.group.position.z = -0.38;
  }
  startReload(now) {
    const st = this.ammo[this.current];
    const w = this.def();
    if (now < this.reloadUntil || st.mag >= w.mag || st.reserve <= 0) return false;
    this.reloadUntil = now + w.reloadTime;
    return true;
  }
  finishReloadIfDue(now, sound) {
    if (this.reloadUntil && now >= this.reloadUntil) {
      const st = this.ammo[this.current];
      const w = this.def();
      const take = Math.min(w.mag - st.mag, st.reserve);
      st.mag += take;
      st.reserve -= take;
      this.reloadUntil = 0;
      if (sound) sound.reloadEnd();
      return true;
    }
    return false;
  }
  refill(id) {
    const w = WEAPONS[id];
    this.ammo[id] = { mag: w.mag, reserve: w.reserve };
  }
  spreadNow(moveSpeed, airborne) {
    const w = this.def();
    let s = w.spread + this.bloom;
    // Movement penalty scales with actual speed: a slow walk barely
    // opens the cone, a sprint blows it wide.
    s += w.spreadMove * Math.min(1, moveSpeed / 4.5);
    if (airborne) s += 0.03;
    return s;
  }
  update(dt, now, moveSpeed) {
    this.bloom = Math.max(0, this.bloom - dt * 0.045);
    this.kickPitch = Math.max(0, this.kickPitch - dt * 0.09);
    this.kickYaw *= Math.max(0, 1 - dt * 7);
    this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 16);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160);
    this.group.position.z += (-0.45 - this.group.position.z) * Math.min(1, dt * 11);
    this.bobT += dt * (2 + moveSpeed * 1.6);
    const reloading = now < this.reloadUntil;
    const targetY = reloading ? -0.38 : (now < this.switchUntil ? -0.42 : -0.245 + Math.sin(this.bobT * 2) * 0.006 * Math.min(1, moveSpeed / 3));
    this.group.position.y += (targetY - this.group.position.y) * Math.min(1, dt * 10);
    this.group.rotation.x = reloading ? -0.7 : this.kickPitch * 1.4;
    this.group.rotation.z = reloading ? 0.25 : 0;
    return this.kickPitch;
  }
}
