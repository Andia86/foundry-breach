// Squad bots: box-built soldiers with a shared brain. A bot perceives
// enemies through the same sight-line rules as everyone else, fights in
// bursts at its weapon's preferred range, and otherwise plays the round:
// Jackals push the reactor pad behind their charge carrier, Wardens hold
// the pad and converge on it once the charge is planted.

import * as THREE from 'three';
import { collideCircle, sightBlocked, findPath, nearestNode, SITE } from './world.js';
import { WEAPONS } from './weapon.js';

const TEAM_COLORS = {
  atk: { cloth: 0xa03d24, dark: 0x5f2317, skin: 0xc9995f, strip: 0xff7a3c },
  def: { cloth: 0x1f6f66, dark: 0x14423d, skin: 0xb98a56, strip: 0x2ee6c8 },
};

export class Bot {
  constructor(scene, team, name, id) {
    this.id = id;
    this.team = team;
    this.name = name;
    this.isPlayer = false;
    this.radius = 0.42;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 100;
    this.alive = true;
    this.armor = false;
    this.weaponId = 'pistol';
    this.hasCharge = false;
    this.speedNow = 0;

    // brain state
    this.path = [];
    this.pathI = 0;
    this.thinkAt = Math.random() * 0.2;
    this.engage = null;
    this.engageUntil = 0;
    this.reactionAt = 0;
    this.burstLeft = 0;
    this.nextShotAt = 0;
    this.strafeDir = 1;
    this.strafeUntil = 0;
    this.holdNode = -1;
    this.walkPhase = Math.random() * 6;
    this.retreatNode = -1;
    this.retreatUntil = 0;
    this.retreatReadyAt = 0;

    const c = TEAM_COLORS[team];
    const mat = (color, rough = 0.85) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    // Cloth carries a whisper of team-colour emissive so silhouettes stay
    // readable against dark floors and shadowed corners.
    const clothMat = new THREE.MeshStandardMaterial({ color: c.cloth, roughness: 0.85, emissive: c.cloth, emissiveIntensity: 0.16 });
    const g = new THREE.Group();
    this.mesh = g;
    const add = (geo, material, x, y, z) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    this.legL = add(new THREE.BoxGeometry(0.17, 0.78, 0.2), mat(c.dark), -0.13, 0.39, 0);
    this.legR = add(new THREE.BoxGeometry(0.17, 0.78, 0.2), mat(c.dark), 0.13, 0.39, 0);
    this.torso = add(new THREE.BoxGeometry(0.52, 0.62, 0.3), clothMat, 0, 1.09, 0);
    const strip = add(new THREE.BoxGeometry(0.54, 0.09, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x101010, emissive: c.strip, emissiveIntensity: 1.6 }), 0, 1.22, 0);
    strip.castShadow = false;
    this.head = add(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat(c.skin), 0, 1.56, 0);
    add(new THREE.BoxGeometry(0.34, 0.13, 0.34), mat(c.dark), 0, 1.74, 0);
    this.gun = add(new THREE.BoxGeometry(0.09, 0.15, 0.72), mat(0x3a3e44, 0.42), 0.2, 1.2, -0.34);
    // Floating team diamond: at engagement range a bot is a few pixels,
    // and friend-or-foe must read instantly, not by squinting at cloth.
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1),
      new THREE.MeshBasicMaterial({ color: c.strip }),
    );
    marker.position.y = 2.14;
    g.add(marker);
    this.armR = add(new THREE.BoxGeometry(0.13, 0.5, 0.13), clothMat, 0.33, 1.12, -0.12);
    this.armR.rotation.x = -0.9;
    // Muzzle flash quad at the barrel tip, lit for a frame or two per shot.
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffc37a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.flashMat);
    this.flash.position.set(0.18, 1.2, -0.72);
    this.flash.castShadow = false;
    g.add(this.flash);
    scene.add(g);
  }
  muzzleFlash() {
    this.flashMat.opacity = 0.95;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.6;
    this.flash.scale.set(s, s, s);
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.56, this.pos.z); }
  reset(x, z, yaw, loadout) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.hp = 100;
    this.alive = true;
    this.armor = loadout.armor;
    this.weaponId = loadout.weaponId;
    this.hasCharge = false;
    this.path = [];
    this.engage = null;
    this.channelWanted = null;
    this.retreatNode = -1;
    this.retreatUntil = 0;
    this.retreatReadyAt = 0;
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.position.copy(this.pos);
    this.mesh.visible = true;
    const gunLen = { pistol: 0.4, smg: 0.55, scatter: 0.7, rifle: 0.8 }[this.weaponId];
    this.gun.scale.z = gunLen / 0.72;
  }
  die() {
    this.alive = false;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.25;
  }
  syncMesh(dt) {
    if (!this.alive) return;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (this.flashMat) this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 18);
    const swing = Math.sin(this.walkPhase) * Math.min(1, this.speedNow / 3) * 0.55;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.walkPhase += dt * (2 + this.speedNow * 2.2);
  }
}

const PREF_RANGE = { pistol: 13, smg: 15, scatter: 7.5, rifle: 21 };

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function stepBot(bot, dt, now, ctx) {
  if (!bot.alive) return;
  const { world, actors } = ctx;
  bot.speedNow = 0;

  // Shared movement tail: separation from squadmates, collision, mesh sync.
  // Declared as a closure so the retreat branch can reuse it and bail out.
  function moveAndCollide() {
    if (moveX || moveZ) {
      let nx = bot.pos.x + moveX * speed * dt;
      let nz = bot.pos.z + moveZ * speed * dt;
      for (const a of actors) {
        if (a === bot || !a.alive) continue;
        const dx = nx - a.pos.x, dz = nz - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.81 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx += (dx / d) * (0.9 - d) * 0.6;
          nz += (dz / d) * (0.9 - d) * 0.6;
        }
      }
      const [cx, cz] = collideCircle(world.colliders, nx, nz, bot.radius);
      bot.speedNow = Math.hypot(cx - bot.pos.x, cz - bot.pos.z) / Math.max(dt, 1e-4);
      bot.pos.x = THREE.MathUtils.clamp(cx, -37.4, 37.4);
      bot.pos.z = THREE.MathUtils.clamp(cz, -37.4, 37.4);
    }
    bot.syncMesh(dt);
  }

  // --- perception (staggered think ticks) ---
  if (now >= bot.thinkAt) {
    bot.thinkAt = now + 0.14 + Math.random() * 0.06;
    let best = null, bd = 42 * 42;
    for (const a of actors) {
      if (!a.alive || a.team === bot.team) continue;
      const dx = a.pos.x - bot.pos.x, dz = a.pos.z - bot.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bd) continue;
      if (sightBlocked(world.colliders, bot.pos.x, bot.pos.z, a.pos.x, a.pos.z)) continue;
      bd = d2; best = a;
    }
    if (best) {
      if (bot.engage !== best) bot.reactionAt = now + 0.32 + Math.random() * 0.4;
      bot.engage = best;
      bot.engageUntil = now + 1.6;
    } else if (now > bot.engageUntil) {
      bot.engage = null;
    }
  }

  const target = bot.engage && bot.engage.alive ? bot.engage : null;
  let moveX = 0, moveZ = 0, speed = 3.7;

  // Working the charge beats fighting when the site is effectively clear:
  // a carrier (or a defuser) with nobody close stands on the pad and works.
  if (target) {
    const g = ctx.botGoal(bot);
    const td = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
    if (g && g.channel && td > 15) {
      bot.channelWanted = g.channel;
      bot.syncMesh(dt);
      return;
    }
    bot.channelWanted = null;
  }

  if (target) {
    const dx = target.pos.x - bot.pos.x, dz = target.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const wantYaw = Math.atan2(-dx, -dz);
    bot.yaw = angleLerp(bot.yaw, wantYaw, Math.min(1, dt * 10));

    // Hurt bots break off and run for real cover instead of trading shots
    // standing in the open: pick the nearest waypoint the shooter cannot
    // see, path to it, and only shoot back at point-blank while running.
    if (bot.hp < 38 && now >= bot.retreatReadyAt && bot.retreatNode === -1 && dist > 6) {
      let bestNode = -1, bd = Infinity;
      for (let i = 0; i < world.nodes.length; i++) {
        const n = world.nodes[i];
        const d = Math.hypot(n.x - bot.pos.x, n.y - bot.pos.z);
        if (d < 3.5 || d > 17) continue;
        if (!sightBlocked(world.colliders, n.x, n.y, target.pos.x, target.pos.z)) continue;
        if (d < bd) { bd = d; bestNode = i; }
      }
      if (bestNode !== -1) {
        bot.retreatNode = bestNode;
        bot.retreatUntil = now + 3.4;
        bot.path = findPath(world.graph, world.nodes, nearestNode(world.nodes, bot.pos.x, bot.pos.z), bestNode) ?? [bestNode];
        bot.pathI = 0;
      }
      bot.retreatReadyAt = now + 7;
    }
    if (bot.retreatNode !== -1) {
      if (now > bot.retreatUntil) bot.retreatNode = -1;
      else {
        const n = world.nodes[bot.path[Math.min(bot.pathI, bot.path.length - 1)] ?? bot.retreatNode];
        const rx = n.x - bot.pos.x, rz = n.y - bot.pos.z;
        const rd = Math.hypot(rx, rz);
        if (rd < 1.1 && bot.pathI < bot.path.length - 1) bot.pathI += 1;
        else if (rd >= 0.05) {
          moveX = rx / (rd || 1); moveZ = rz / (rd || 1); speed = 4.2;
          bot.yaw = angleLerp(bot.yaw, Math.atan2(-moveX, -moveZ), Math.min(1, dt * 7));
        }
        // Point-blank self-defence only while falling back.
        if (dist < 9 && now >= bot.reactionAt && now >= bot.nextShotAt
          && !sightBlocked(world.colliders, bot.pos.x, bot.pos.z, target.pos.x, target.pos.z)) {
          bot.nextShotAt = now + WEAPONS[bot.weaponId].interval * 2;
          ctx.botShoot(bot, target, dist);
        }
        // fall through to the shared movement/collision code below
        moveAndCollide();
        return;
      }
    }

    const pref = PREF_RANGE[bot.weaponId];
    if (dist > pref + 3) {
      moveX = dx / dist; moveZ = dz / dist; speed = 3.9;
    } else if (dist < pref - 4) {
      moveX = -dx / dist; moveZ = -dz / dist; speed = 2.4;
    } else {
      if (now >= bot.strafeUntil) {
        bot.strafeUntil = now + 0.7 + Math.random() * 0.9;
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      moveX = (-dz / dist) * bot.strafeDir;
      moveZ = (dx / dist) * bot.strafeDir;
      speed = 2.1;
    }
    // Fire control: bursts with a reaction delay, only on a live sight line.
    if (now >= bot.reactionAt && now >= bot.nextShotAt) {
      const blocked = sightBlocked(world.colliders, bot.pos.x, bot.pos.z, target.pos.x, target.pos.z);
      if (!blocked) {
        if (bot.burstLeft <= 0) {
          // New burst starts almost at once — the reaction delay already
          // gated the engagement; a second long pause read as passivity.
          bot.burstLeft = bot.weaponId === 'scatter' ? 1 : 2 + Math.floor(Math.random() * 3);
          bot.nextShotAt = now + 0.04;
        } else {
          bot.burstLeft -= 1;
          bot.nextShotAt = now + WEAPONS[bot.weaponId].interval * (1.15 + Math.random() * 0.2);
          ctx.botShoot(bot, target, dist);
        }
      }
    }
  } else {
    // --- objective movement ---
    const goal = ctx.botGoal(bot);
    if (goal && goal.channel) {
      bot.channelWanted = goal.channel;
      return; // standing in the zone, working the charge
    }
    bot.channelWanted = null;
    if (goal) {
      const here = nearestNode(world.nodes, bot.pos.x, bot.pos.z);
      if (!bot.path.length || bot.path[bot.path.length - 1] !== goal.node) {
        bot.path = findPath(world.graph, world.nodes, here, goal.node) ?? [goal.node];
        bot.pathI = 0;
      }
      // Follow waypoints, but head straight at the goal when it is the last leg.
      let tx, tz;
      const lastLeg = bot.pathI >= bot.path.length - 1;
      if (lastLeg && goal.point) { tx = goal.point.x; tz = goal.point.z; }
      else {
        const n = world.nodes[bot.path[Math.min(bot.pathI, bot.path.length - 1)]];
        tx = n.x; tz = n.y;
      }
      const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.1 && !lastLeg) bot.pathI += 1;
      else if (dist >= 0.05) {
        moveX = dx / (dist || 1); moveZ = dz / (dist || 1);
        bot.yaw = angleLerp(bot.yaw, Math.atan2(-moveX, -moveZ), Math.min(1, dt * 6));
      }
      if (goal.hold && dist < 1.4) { moveX = 0; moveZ = 0; bot.yaw += Math.sin(now * 0.6 + bot.id) * dt * 0.4; }
    }
  }

  moveAndCollide();
}
