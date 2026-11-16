// Foundry Breach — game orchestration.
// Round state machine (buy → live → planted → round end → match end),
// economy and loadouts, the breach-charge plant/defuse channels, hitscan
// damage for the player, probability-resolved fire for the bots, tracers,
// and the deterministic demo modes the screenshots are taken from.

import * as THREE from 'three';
import { buildWorld, sightBlocked, SITE } from './world.js';
import { Player } from './player.js';
import { WEAPONS, BUY_ORDER, ARMOR_PRICE, SoundBank, WeaponRig } from './weapon.js';
import { Bot, stepBot } from './bots.js';
import { Hud, renderBuyMenu } from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = Number(params.get('seed') ?? 1);
let rngState = SEED * 2654435761 >>> 0;
function rng() {
  rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5;
  return ((rngState >>> 0) / 4294967296);
}
const rand = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];

const WIN_SCORE = 6;
const ROUND_TIME = 100;
const FUSE_TIME = 30;
const BUY_TIME = 8;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 300);
scene.add(camera);

const world = buildWorld(scene);
const sound = new SoundBank();
const hud = new Hud();
const player = new Player(camera, renderer.domElement, world.colliders);
const rig = new WeaponRig(camera);

const JACKAL_NAMES = ['Vex', 'Mara', 'Odo', 'Pell'];
const WARDEN_NAMES = ['Ana', 'Ilya', 'Moss', 'Reyes', 'Falk'];

const playerActor = {
  id: 0, team: 'atk', name: 'You', isPlayer: true,
  hp: 100, alive: true, armor: false, weaponId: 'pistol', hasCharge: false, radius: 0.42,
  get pos() { return player.pos; },
  get yaw() { return player.yaw; },
  get eye() { return player.eye; },
  get speedNow() { return player.moveSpeedNow; },
};
const bots = [];
for (let i = 0; i < 4; i++) bots.push(new Bot(scene, 'atk', JACKAL_NAMES[i], i + 1));
for (let i = 0; i < 5; i++) bots.push(new Bot(scene, 'def', WARDEN_NAMES[i], i + 5));
const demoLead = new Bot(scene, 'atk', 'Vex (demo)', 10); // fifth Jackal, demo mode only
demoLead.mesh.visible = false;

let actors = [playerActor, ...bots];

const G = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 0,
  scoreJ: 0, scoreW: 0,
  timeLeft: 0,
  phaseAt: 0,
  planted: false,
  fuseLeft: 0,
  carrier: null,
  chargeDrop: null, // THREE.Vector3 when the charge is on the ground
  channel: null, // { actor, kind: 'plant'|'defuse', t, need }
  money: 800,
  owned: new Set(['pistol']),
  kills: 0,
  demo: false,
  over: false,
};

const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
function tracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = tracerMat.clone();
  mat.color.set(color);
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, until: performance.now() / 1000 + 0.07 });
}
function muzzleOf(actor) {
  if (actor.isPlayer) return actor.eye.clone().add(new THREE.Vector3(0, -0.12, 0));
  const fwd = new THREE.Vector3(-Math.sin(actor.yaw), 0, -Math.cos(actor.yaw));
  return actor.pos.clone().add(new THREE.Vector3(0, 1.24, 0)).addScaledVector(fwd, 0.55);
}

// ---------- damage & shooting ----------

function damageFalloff(dmg, dist) {
  return dist <= 25 ? dmg : dmg * Math.max(0.5, 1 - (dist - 25) / 110);
}

function applyDamage(victim, dmg, attacker, weaponId, head) {
  if (!victim.alive || G.phase === 'roundEnd' || G.phase === 'matchEnd') return;
  if (victim.armor) dmg *= head ? 0.7 : 0.55;
  victim.hp -= dmg;
  const killed = victim.hp <= 0;
  if (attacker.isPlayer) {
    hud.hitmarker(killed);
    sound.hit(killed);
  }
  if (victim.isPlayer) {
    hud.damageFlash();
    sound.hurt();
  }
  if (killed) kill(victim, attacker, weaponId, head);
}

function kill(victim, attacker, weaponId, head) {
  victim.hp = 0;
  victim.alive = false;
  if (victim.hasCharge) {
    victim.hasCharge = false;
    G.carrier = null;
    G.chargeDrop = victim.pos.clone();
    dropMesh.visible = true;
    dropMesh.position.copy(G.chargeDrop).setY(0.25);
  }
  if (!victim.isPlayer) victim.die();
  else {
    player.enabled = false;
    player.unlock();
  }
  hud.killfeed(attacker, victim, WEAPONS[weaponId].name + (head ? ' ⌖' : ''));
  if (attacker.isPlayer && attacker !== victim) {
    G.kills += 1;
    G.money += 300;
  }
  checkRoundEnd();
}

function rayVsBot(origin, dir, bot) {
  // Closest approach of the ray to the bot's vertical capsule, in plan view,
  // with the height at that point deciding body vs head.
  const ox = origin.x - bot.pos.x, oz = origin.z - bot.pos.z;
  const dx = dir.x, dz = dir.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return null;
  let t = -(ox * dx + oz * dz) / a;
  if (t < 0) return null;
  const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
  const py = origin.y + dir.y * t;
  const dh = Math.hypot(px - bot.pos.x, pz - bot.pos.z);
  if (dh > 0.44 || py < 0 || py > 1.84) return null;
  return { t, head: py > 1.4 };
}

function playerShoot(now) {
  const w = rig.def();
  if (!rig.canFire(now)) {
    if (rig.state().mag === 0 && now >= rig.nextShotAt) sound.dryFire();
    return;
  }
  rig.fire(now);
  sound.shot(w.id);
  const spread = rig.spreadNow(player.moveSpeedNow > 0.6, !player.grounded);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  for (let p = 0; p < w.pellets; p++) {
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * 2 * spread;
    d.y += (Math.random() - 0.5) * 2 * spread;
    d.z += (Math.random() - 0.5) * 2 * spread;
    d.normalize();
    const origin = player.eye;
    let best = null;
    for (const a of actors) {
      if (!a.alive || a.team === 'atk' || a.isPlayer) continue;
      const hit = rayVsBot(origin, d, a);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, actor: a };
    }
    // World blockers: nearest sight-blocking collider crossing in plan view.
    let blockT = Infinity;
    for (const c of world.colliders) {
      if (!c.sight) continue;
      const t = rayBoxXZ(origin, d, c);
      if (t !== null && t < blockT) blockT = t;
    }
    const from = muzzleOf(playerActor);
    if (best && best.t < blockT) {
      const hitPoint = origin.clone().addScaledVector(d, best.t);
      tracer(from, hitPoint, w.tracer);
      const dist = best.t;
      let dmg = damageFalloff(w.damage, dist) * (best.head ? w.headMult : 1);
      applyDamage(best.actor, dmg, playerActor, w.id, best.head);
    } else if (blockT < 60) {
      tracer(from, origin.clone().addScaledVector(d, blockT), w.tracer);
    } else {
      tracer(from, origin.clone().addScaledVector(d, 60), w.tracer);
    }
  }
  if (rig.state().mag === 0) tryReload(now);
}

function rayBoxXZ(origin, dir, c) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, mn, mx] of [[origin.x, dir.x, c.minX, c.maxX], [origin.z, dir.z, c.minZ, c.maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) return null; }
    else {
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return null;
    }
  }
  const y = origin.y + dir.y * t0;
  if (y < 0 || y > 4.6) return null;
  return t0;
}

function botShoot(bot, target, dist) {
  const w = WEAPONS[bot.weaponId];
  if (dist < 34) sound.shot(bot.weaponId);
  const from = muzzleOf(bot);
  const aimAt = target.eye.clone();
  aimAt.y -= 0.25;
  let chance = { pistol: 0.30, smg: 0.38, scatter: 0.52, rifle: 0.33 }[bot.weaponId];
  if (dist > 20) chance -= 0.07;
  if (target.speedNow > 4) chance -= 0.07;
  if (bot.weaponId === 'scatter' && dist > 11) chance -= 0.25;
  const hit = Math.random() < chance;
  if (hit) {
    tracer(from, aimAt, w.tracer);
    const head = Math.random() < 0.1;
    let dmg = damageFalloff(w.damage, dist) * rand(0.45, 0.75) * (head ? w.headMult * 0.8 : 1);
    if (bot.weaponId === 'scatter') dmg *= rand(1.2, 2.2);
    applyDamage(target, dmg, bot, bot.weaponId, head);
  } else {
    const miss = aimAt.clone();
    miss.x += rand(-1.6, 1.6); miss.y += rand(-0.7, 0.9); miss.z += rand(-1.6, 1.6);
    tracer(from, miss, w.tracer);
  }
}

// ---------- the charge ----------

const dropMesh = new THREE.Group();
{
  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.3, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xff5030, emissiveIntensity: 1.4 }),
  );
  pack.position.y = 0;
  dropMesh.add(pack);
  dropMesh.visible = false;
  scene.add(dropMesh);
}
const plantLight = new THREE.PointLight(0xff4030, 0, 16, 1.8);
plantLight.position.set(SITE.x, 2.5, SITE.z);
scene.add(plantLight);

function inSite(x, z) {
  return Math.hypot(x - SITE.x, z - SITE.z) < SITE.r;
}

function startChannel(actor, kind) {
  G.channel = { actor, kind, t: 0, need: kind === 'plant' ? 3 : 5 };
  if (actor.isPlayer) hud.channel(0, kind === 'plant' ? 'PLANTING THE CHARGE' : 'DEFUSING');
}
function cancelChannel() {
  if (G.channel && G.channel.actor.isPlayer) hud.channel(null);
  G.channel = null;
}
function stepChannel(dt) {
  const ch = G.channel;
  if (!ch) return;
  const a = ch.actor;
  if (!a.alive || !inSite(a.pos.x, a.pos.z)) { cancelChannel(); return; }
  if (a.isPlayer && !keysDown.has('KeyF')) { cancelChannel(); return; }
  if (!a.isPlayer && a.channelWanted !== ch.kind) { cancelChannel(); return; }
  ch.t += dt;
  if (a.isPlayer) hud.channel(ch.t / ch.need, ch.kind === 'plant' ? 'PLANTING THE CHARGE' : 'DEFUSING');
  if (ch.t >= ch.need) {
    const kind = ch.kind;
    cancelChannel();
    if (kind === 'plant') {
      G.planted = true;
      G.fuseLeft = FUSE_TIME;
      plantLight.intensity = 20;
      sound.beep(true);
      hud.banner('CHARGE PLANTED', 'The Wardens have 30 seconds to pull it apart', 'lose');
      setTimeout(() => hud.hideBanner(), 2200);
    } else {
      endRound('def', 'The charge was defused');
    }
  }
}

// ---------- round flow ----------

function teamAlive(team) { return actors.filter((a) => a.team === team && a.alive).length; }

function checkRoundEnd() {
  if (G.phase !== 'live') return;
  if (teamAlive('def') === 0) endRound('atk', 'Wardens eliminated');
  else if (teamAlive('atk') === 0) endRound('def', 'Jackals eliminated');
}

function endRound(winner, reason) {
  if (G.phase === 'roundEnd' || G.phase === 'matchEnd') return;
  cancelChannel();
  G.phase = 'roundEnd';
  G.phaseAt = nowSec();
  plantLight.intensity = 0;
  const playerWon = winner === 'atk';
  if (winner === 'atk') G.scoreJ += 1; else G.scoreW += 1;
  hud.setScore(G.scoreJ, G.scoreW);
  if (!G.demo) {
    G.money += playerWon ? 1400 : 1200;
    sound.sting(playerWon);
    hud.banner(playerWon ? 'ROUND WON' : 'ROUND LOST', reason, playerWon ? 'win' : 'lose');
  }
  if (!playerActor.alive) {
    // Death costs the loadout: back to the pistol next round.
    G.owned = new Set(['pistol']);
    playerActor.armor = false;
  }
}

function explode() {
  sound.explosion();
  plantLight.intensity = 90;
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa050, transparent: true, opacity: 0.95 }),
  );
  flash.position.set(SITE.x, 1.6, SITE.z);
  scene.add(flash);
  let s = 1;
  const grow = setInterval(() => {
    s += 2.4;
    flash.scale.setScalar(s);
    flash.material.opacity = Math.max(0, 0.95 - s * 0.1);
    plantLight.intensity = Math.max(0, 90 - s * 9);
    if (s > 10) { clearInterval(grow); scene.remove(flash); }
  }, 40);
  endRound('atk', 'The charge detonated');
}

function botLoadout(round, i) {
  if (round <= 1) return { weaponId: 'pistol', armor: false };
  const roll = rng();
  return {
    weaponId: roll < 0.38 ? 'rifle' : roll < 0.68 ? 'smg' : roll < 0.8 ? 'scatter' : 'pistol',
    armor: rng() < 0.55,
  };
}

function startRound() {
  G.round += 1;
  G.phase = 'buy';
  G.phaseAt = nowSec();
  G.timeLeft = BUY_TIME;
  G.planted = false;
  G.fuseLeft = 0;
  G.channel = null;
  G.chargeDrop = null;
  dropMesh.visible = false;
  plantLight.intensity = 0;

  // Player reset.
  playerActor.hp = 100;
  playerActor.alive = true;
  playerActor.hasCharge = false;
  const ps = world.spawns.atk[0];
  player.spawn(ps[0], ps[1], -Math.PI / 2);
  player.enabled = false;
  for (const id of G.owned) rig.refill(id);
  const best = G.owned.has('rifle') ? 'rifle' : G.owned.has('smg') ? 'smg' : G.owned.has('scatter') ? 'scatter' : 'pistol';
  rig.equip(best, 0);
  playerActor.weaponId = rig.current;

  // Bots reset.
  const squad = G.demo ? [demoLead, ...bots] : bots;
  let ai = 1, di = 0;
  for (const bot of squad) {
    const isAtk = bot.team === 'atk';
    const spawn = isAtk ? world.spawns.atk[ai++ % 5] : world.spawns.def[di++ % 5];
    const yaw = isAtk ? -Math.PI / 2 : Math.PI / 2;
    bot.reset(spawn[0], spawn[1], yaw, botLoadout(G.round, bot.id));
  }
  if (G.demo) { demoLead.mesh.visible = true; }

  // The charge: a random living Jackal carries it.
  const jackals = squad.filter((b) => b.team === 'atk').concat(G.demo ? [] : [playerActor]);
  const carrier = G.demo ? demoLead : pick(jackals);
  carrier.hasCharge = true;
  G.carrier = carrier;

  hud.setScore(G.scoreJ, G.scoreW);
  hud.setAlive(teamAlive('atk'), teamAlive('def'));
  hud.banner(`ROUND ${G.round}`, carrier.isPlayer ? 'You carry the breach charge' : `${carrier.name} carries the breach charge`, '');
  if (!G.demo) openBuy();
}

function openBuy() {
  renderBuyMenu(buyItems(), G.money, doBuy);
  document.getElementById('buy').hidden = false;
}
function closeBuy() {
  document.getElementById('buy').hidden = true;
}
function buyItems() {
  const items = BUY_ORDER.map((id, i) => ({
    id, key: String(i + 1), name: WEAPONS[id].name,
    desc: { smg: 'Fast, forgiving, close-range', scatter: 'Seven pellets, one argument', rifle: 'Precise, hard-hitting, the real thing' }[id],
    price: WEAPONS[id].price, owned: G.owned.has(id), afford: G.money >= WEAPONS[id].price,
  }));
  items.push({
    id: 'armor', key: '4', name: 'Plate vest',
    desc: 'Cuts body damage nearly in half', price: ARMOR_PRICE,
    owned: playerActor.armor, afford: G.money >= ARMOR_PRICE,
  });
  return items;
}
function doBuy(id) {
  if (G.phase !== 'buy') return;
  if (id === 'armor') {
    if (playerActor.armor || G.money < ARMOR_PRICE) return;
    G.money -= ARMOR_PRICE;
    playerActor.armor = true;
  } else {
    const w = WEAPONS[id];
    if (G.owned.has(id) || G.money < w.price) return;
    G.money -= w.price;
    G.owned.add(id);
    rig.refill(id);
    rig.equip(id, nowSec());
    playerActor.weaponId = id;
  }
  sound.buy();
  renderBuyMenu(buyItems(), G.money, doBuy);
}

function startMatch() {
  G.scoreJ = 0; G.scoreW = 0; G.round = 0; G.money = 800; G.kills = 0;
  G.owned = new Set(['pistol']);
  playerActor.armor = false;
  G.over = false;
  actors = G.demo ? [demoLead, ...bots] : [playerActor, ...bots];
  startRound();
}

function endMatch() {
  G.phase = 'matchEnd';
  G.over = true;
  player.enabled = false;
  player.unlock();
  closeBuy();
  const won = G.scoreJ > G.scoreW;
  document.getElementById('final-title').textContent = won ? 'The foundry is yours' : 'The Wardens hold the foundry';
  document.getElementById('final-score').innerHTML =
    `<span class="j">${G.scoreJ}</span> — <span class="w">${G.scoreW}</span>`;
  document.getElementById('final-copy').textContent = won
    ? `The reactor is breached and the night shift is over. You finished with ${G.kills} kills.`
    : `The charge never told its story. You finished with ${G.kills} kills — the yard will still be here tomorrow.`;
  document.getElementById('matchend').hidden = false;
}

// ---------- bot direction ----------

const DEF_HOLDS = [7, 6, 20, 13, 16];
const ATK_PUSH = [6, 5, 13, 16];
function botGoal(bot) {
  if (G.phase !== 'live') return { node: nearestNodeSafe(bot), hold: true };
  const squad = actors;
  if (bot.team === 'atk') {
    if (G.chargeDrop && !G.planted) {
      const near = squad.filter((a) => a.team === 'atk' && a.alive)
        .sort((a, b) => a.pos.distanceTo(G.chargeDrop) - b.pos.distanceTo(G.chargeDrop))[0];
      if (near === bot) return { node: nearestNodeSafe(bot), point: { x: G.chargeDrop.x, z: G.chargeDrop.z } };
    }
    if (bot.hasCharge) {
      if (inSite(bot.pos.x, bot.pos.z)) return { channel: 'plant' };
      return { node: 7 };
    }
    if (G.planted) return { node: pick([6, 13, 20]), hold: true };
    return { node: ATK_PUSH[bot.id % ATK_PUSH.length] };
  }
  // Wardens.
  if (G.planted) {
    if (inSite(bot.pos.x, bot.pos.z)) return { channel: 'defuse' };
    return { node: 7, point: { x: SITE.x - 3, z: SITE.z + 2 } };
  }
  return { node: DEF_HOLDS[bot.id % DEF_HOLDS.length], hold: true };
}
function nearestNodeSafe(bot) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < world.nodes.length; i++) {
    const dx = world.nodes[i].x - bot.pos.x, dz = world.nodes[i].y - bot.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Charge pickup by walking over the drop.
function stepChargePickup() {
  if (!G.chargeDrop || G.planted || G.phase !== 'live') return;
  for (const a of actors) {
    if (!a.alive || a.team !== 'atk') continue;
    if (Math.hypot(a.pos.x - G.chargeDrop.x, a.pos.z - G.chargeDrop.z) < 1.3) {
      a.hasCharge = true;
      G.carrier = a;
      G.chargeDrop = null;
      dropMesh.visible = false;
      if (a.isPlayer) hud.banner('CHARGE TAKEN', 'Get to the reactor pad and hold F', '');
      if (a.isPlayer) setTimeout(() => hud.hideBanner(), 1600);
      return;
    }
  }
}

// ---------- input ----------

const keysDown = new Set();
let mouseDown = false;
window.addEventListener('keydown', (e) => {
  keysDown.add(e.code);
  if (G.phase === 'buy' && !G.demo) {
    const map = { Digit1: 'smg', Digit2: 'scatter', Digit3: 'rifle', Digit4: 'armor' };
    if (map[e.code]) doBuy(map[e.code]);
  } else if (G.phase === 'live' && !G.demo) {
    const slot = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'scatter', Digit4: 'rifle' }[e.code];
    if (slot && G.owned.has(slot)) { rig.equip(slot, nowSec()); playerActor.weaponId = slot; }
    if (e.code === 'KeyR') tryReload(nowSec());
  }
});
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
  if (!G.demo && G.phase === 'live' && playerActor.alive && !player.locked) player.lock();
  sound.unlock();
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });

function tryReload(now) {
  if (rig.startReload(now)) sound.reloadStart();
}

document.getElementById('play-btn').addEventListener('click', () => {
  sound.unlock();
  document.getElementById('menu').hidden = true;
  hud.show();
  G.demo = false;
  startMatch();
});
document.getElementById('again-btn').addEventListener('click', () => {
  document.getElementById('matchend').hidden = true;
  startMatch();
});

// ---------- per-frame ----------

const clock = new THREE.Clock();
function nowSec() { return performance.now() / 1000; }

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const now = nowSec();
  const t = clock.elapsedTime;
  world.update(t);
  // The viewmodel belongs to the player's eyes only: menu vistas, the demo
  // and the match-end shot are spectator cameras and must not grow a gun.
  rig.group.visible = !G.demo && (G.phase === 'buy' || G.phase === 'live' || G.phase === 'roundEnd');

  // Tracers fade.
  for (let i = tracers.length - 1; i >= 0; i--) {
    if (now > tracers[i].until) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }

  if (G.phase === 'menu' || SHOT === 'start') {
    // Slow vista orbit for the menu backdrop.
    const a = t * 0.05;
    camera.position.set(6 + Math.cos(a) * 17, 5.2, 6 + Math.sin(a) * 17);
    camera.lookAt(14, 1.2, -6);
    renderer.render(scene, camera);
    return;
  }
  if (SHOT === 'end') {
    camera.position.set(12, 3.4, 8);
    camera.lookAt(SITE.x, 1.4, SITE.z);
    renderer.render(scene, camera);
    return;
  }

  if (G.phase === 'buy') {
    G.timeLeft -= dt;
    if (!G.demo) player.update(dt); // frozen, but the camera sits at spawn
    hud.setTimer(G.timeLeft, 'buy');
    const bt = document.getElementById('buy-timer');
    if (bt) bt.textContent = Math.max(0, Math.ceil(G.timeLeft));
    if (G.demo) hud.setTimer(G.timeLeft, 'buy');
    if (G.timeLeft <= 0) {
      closeBuy();
      hud.hideBanner();
      G.phase = 'live';
      G.timeLeft = ROUND_TIME;
      if (!G.demo) { player.enabled = true; player.lock(); }
    }
  } else if (G.phase === 'live') {
    if (G.planted) {
      G.fuseLeft -= dt;
      hud.setTimer(G.fuseLeft, 'planted');
      plantLight.intensity = 16 + Math.sin(now * 9) * 8;
      if (G.fuseLeft <= 0 && G.phase === 'live') explode();
    } else {
      G.timeLeft -= dt;
      hud.setTimer(G.timeLeft, 'live');
      if (G.timeLeft <= 0) endRound('def', 'Time — the foundry keeps its secrets');
    }
    // Bots begin their plant/defuse channels on their own say-so.
    if (!G.channel) {
      for (const b of actors) {
        if (!b.isPlayer && b.alive && b.channelWanted) { startChannel(b, b.channelWanted); break; }
      }
    }
    stepChannel(dt);
    stepChargePickup();
  } else if (G.phase === 'roundEnd') {
    if (now - G.phaseAt > 4.2) {
      hud.hideBanner();
      if (G.scoreJ >= WIN_SCORE || G.scoreW >= WIN_SCORE || G.round >= 11) {
        if (G.demo) { G.scoreJ = 0; G.scoreW = 0; G.round = 0; startRound(); }
        else endMatch();
      } else startRound();
    }
  }

  // Actors.
  if (G.phase === 'buy' || G.phase === 'live' || G.phase === 'roundEnd') {
    if (!G.demo && playerActor.alive && G.phase === 'live') {
      player.update(dt);
      if (mouseDown && player.locked) playerShoot(now);
      rig.finishReloadIfDue(now, sound);
      const kick = rig.update(dt, now, player.moveSpeedNow);
      if (kick > 0) { /* recoil is visual on the rig; camera kick below */ }
      playerActor.weaponId = rig.current;
      hud.setVitals(playerActor.hp, playerActor.armor);
      const st = rig.state();
      hud.setGun(WEAPONS[rig.current].name, st.mag, st.reserve, G.money, rig.isReloading(now));
      // Plant prompt / channel for the player.
      if (playerActor.hasCharge && !G.planted && G.phase === 'live') {
        if (inSite(player.pos.x, player.pos.z)) {
          hud.prompt('Hold <b>F</b> to plant the breach charge');
          if (keysDown.has('KeyF') && !G.channel) startChannel(playerActor, 'plant');
        } else {
          hud.prompt('Carry the charge to the <b>reactor pad</b> (gold ring, east yard)');
        }
      } else hud.prompt(null);
    } else if (!G.demo && !playerActor.alive) {
      // Death cam: low, still, watching the yard.
      camera.position.lerp(new THREE.Vector3(player.pos.x, 0.55, player.pos.z), 0.08);
    }
    const ctx = { world, actors, botShoot, botGoal };
    for (const bot of actors) {
      if (bot.isPlayer) continue;
      if (G.phase === 'live') stepBot(bot, dt, now, ctx);
      else bot.syncMesh(dt);
    }
    if (G.demo) {
      // Spectator camera for the demo: high SE corner, watching the pad and
      // the lane the Jackals push down.
      camera.position.set(6, 4.4, 10);
      camera.lookAt(18, 0.8, -6);
      const lead = actors.find((a) => a.team === 'atk' && a.alive) ?? demoLead;
      hud.setVitals(lead.hp, lead.armor);
      hud.setAlive(teamAlive('atk'), teamAlive('def'));
    }
  }

  hud.setAlive(teamAlive('atk'), teamAlive('def'));
  renderer.render(scene, camera);
}

// Step the live simulation without rendering. The demo screenshot is taken
// a moment after load, so the round is pre-played here: by the time the
// first frame renders, the push is already at the pad and shots have flown.
function prewarm(seconds) {
  const step = 1 / 20;
  const ctx = { world, actors, botShoot, botGoal };
  for (let t = 0; t < seconds && G.phase === 'live'; t += step) {
    G.timeLeft -= step;
    for (const bot of actors) {
      if (!bot.isPlayer) stepBot(bot, step, t, ctx);
    }
    if (!G.channel) {
      for (const b of actors) {
        if (!b.isPlayer && b.alive && b.channelWanted) { startChannel(b, b.channelWanted); break; }
      }
    }
    stepChannel(step);
    stepChargePickup();
    if (G.planted) {
      G.fuseLeft -= step;
      if (G.fuseLeft <= 0) { explode(); break; }
    }
  }
}

// ---------- boot ----------

function boot() {
  if (SHOT === 'play') {
    G.demo = true;
    hud.show();
    document.getElementById('menu').hidden = true;
    startMatch();
    // Skip the buy freeze in the demo so the fight is already moving.
    G.phase = 'live';
    G.timeLeft = ROUND_TIME;
    closeBuy();
    hud.hideBanner();
    prewarm(26);
  } else if (SHOT === 'end') {
    G.demo = true;
    actors = [demoLead, ...bots];
    demoLead.mesh.visible = true;
    let ai = 0, di = 0;
    for (const bot of actors) {
      const isAtk = bot.team === 'atk';
      const spawn = isAtk ? world.spawns.atk[ai++ % 5] : world.spawns.def[di++ % 5];
      bot.reset(spawn[0], spawn[1], isAtk ? -Math.PI / 2 : Math.PI / 2, botLoadout(6, bot.id));
      bot.syncMesh(0);
    }
    G.scoreJ = 6; G.scoreW = 4;
    document.getElementById('menu').hidden = true;
    hud.show();
    hud.setScore(6, 4);
    endMatch();
  } else {
    // Menu backdrop: a few Wardens idle at the pad.
    actors = [playerActor, ...bots];
    let di = 0;
    for (const bot of bots) {
      const spawn = world.spawns.def[di++ % 5];
      bot.reset(spawn[0], spawn[1], Math.PI / 2, { weaponId: 'rifle', armor: true });
      bot.syncMesh(0);
    }
    demoLead.mesh.visible = false;
  }
  frame();
}
boot();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
