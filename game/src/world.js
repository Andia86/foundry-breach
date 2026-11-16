// The Sable Foundry: one compact yard, three lanes into a reactor pad.
// Everything solid registers an AABB collider that the player and the bots
// share, so cover means the same thing to everyone. Sight lines use the
// taller colliders only (a crate you can see over does not hide a bot).

import * as THREE from 'three';

export const SITE = { x: 24, z: -8, r: 6.5 };
export const REACTOR = { x: 27, z: -11 };

const WALL_H = 3.4;

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#33322f';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 38 + Math.random() * 30;
    g.fillStyle = `rgba(${v},${v},${v - 4},${0.16 + Math.random() * 0.2})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(12,12,12,${0.05 + Math.random() * 0.1})`;
    g.beginPath();
    g.ellipse(Math.random() * 512, Math.random() * 512, 18 + Math.random() * 46, 10 + Math.random() * 26, Math.random() * 3, 0, 7);
    g.fill();
  }
  g.strokeStyle = 'rgba(210,170,60,0.20)';
  g.lineWidth = 3;
  g.strokeRect(14, 14, 484, 484);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.anisotropy = 4;
  return tex;
}

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#c9a227';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1c1c1e';
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 128); g.lineTo(i + 16, 128); g.lineTo(i + 144, 0); g.lineTo(i + 128, 0);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildWorld(scene) {
  const colliders = [];
  const dynamics = [];

  scene.background = new THREE.Color(0x232b38);
  scene.fog = new THREE.Fog(0x2b3038, 46, 118);

  const hemi = new THREE.HemisphereLight(0x93aed6, 0x40342a, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
  sun.position.set(-38, 42, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
  sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x5f7ca6, 0.35);
  fill.position.set(30, 24, 34);
  scene.add(fill);

  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x5d6066, roughness: 0.9 }),
    wallDark: new THREE.MeshStandardMaterial({ color: 0x43464c, roughness: 0.92 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x8a4a30, roughness: 0.8, metalness: 0.25 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.45, metalness: 0.7 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x77683f, roughness: 0.85 }),
    crateBlue: new THREE.MeshStandardMaterial({ color: 0x39586e, roughness: 0.85 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.8 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x201408, emissive: 0xff7a26, emissiveIntensity: 2.4 }),
    coreGlow: new THREE.MeshStandardMaterial({ color: 0x0d2020, emissive: 0x2ee6c8, emissiveIntensity: 2.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.95 }),
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // A painted ring marks the reactor pad — the plant zone.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(SITE.r - 0.5, SITE.r, 40),
    new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.02, SITE.z);
  scene.add(ring);
  dynamics.push((t) => { ring.material.opacity = 0.38 + Math.sin(t * 2.2) * 0.14; });

  function box(cx, cz, w, d, h, mat, { collide = true, sight = null, y = 0 } = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, y + h / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    if (collide) {
      colliders.push({
        minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
        sight: sight === null ? h >= 1.5 : sight,
      });
    }
    return m;
  }
  function barrel(x, z, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.25, 12), mat);
    m.position.set(x, 0.625, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    colliders.push({ minX: x - 0.62, maxX: x + 0.62, minZ: z - 0.62, maxZ: z + 0.62, sight: false });
  }

  // Boundary walls.
  box(0, -38.5, 78, 1, 4.4, mats.wallDark);
  box(0, 38.5, 78, 1, 4.4, mats.wallDark);
  box(-38.5, 0, 1, 78, 4.4, mats.wallDark);
  box(38.5, 0, 1, 78, 4.4, mats.wallDark);

  // The furnace hall, centre: four walls with a door gap on each side,
  // and the furnace block itself inside.
  const hw = mats.wall;
  box(-8, -5.5, 1, 7, WALL_H, hw); box(-8, 5.5, 1, 7, WALL_H, hw);      // west wall, gap z -2..2
  box(8, -5.5, 1, 7, WALL_H, hw); box(8, 5.5, 1, 7, WALL_H, hw);       // east wall
  box(-5.5, -9, 6, 1, WALL_H, hw); box(5.5, -9, 6, 1, WALL_H, hw);     // north wall, gap x -2..2 (approx via two segments)
  box(-5.5, 9, 6, 1, WALL_H, hw); box(5.5, 9, 6, 1, WALL_H, hw);       // south wall
  const furnace = box(0, 0, 6, 6, 5.6, mats.rust);
  const furnaceMouth = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 0.3), mats.glow);
  furnaceMouth.position.set(0, 1.4, 3.15);
  scene.add(furnaceMouth);
  const furnaceLight = new THREE.PointLight(0xff7a26, 30, 20, 1.8);
  furnaceLight.position.set(0, 2, 5.5);
  scene.add(furnaceLight);
  dynamics.push((t) => { furnaceLight.intensity = 26 + Math.sin(t * 11) * 4 + Math.sin(t * 23.7) * 3; });
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 9, 12), mats.steel);
  stack.position.set(0, 10, 0);
  stack.castShadow = true;
  scene.add(stack);
  furnace.castShadow = true;

  // The reactor: a squat cylinder on the pad with a glowing core column.
  const reactorBase = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 1, 18), mats.steel);
  reactorBase.position.set(REACTOR.x, 0.5, REACTOR.z);
  reactorBase.castShadow = true; reactorBase.receiveShadow = true;
  scene.add(reactorBase);
  const reactorBody = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 3.6, 18), mats.wallDark);
  reactorBody.position.set(REACTOR.x, 2.8, REACTOR.z);
  reactorBody.castShadow = true;
  scene.add(reactorBody);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 10), mats.coreGlow);
  core.position.set(REACTOR.x, 2.8, REACTOR.z);
  scene.add(core);
  const coreLight = new THREE.PointLight(0x2ee6c8, 26, 17, 1.8);
  coreLight.position.set(REACTOR.x, 3, REACTOR.z);
  scene.add(coreLight);
  dynamics.push((t) => { coreLight.intensity = 22 + Math.sin(t * 3.1) * 5; });
  colliders.push({ minX: REACTOR.x - 2.3, maxX: REACTOR.x + 2.3, minZ: REACTOR.z - 2.3, maxZ: REACTOR.z + 2.3, sight: true });

  // North lane ("the Catwalk"): long low walls and a raised platform edge.
  box(-14, -20, 10, 2, 2.6, mats.rust);
  box(6, -21, 12, 2, 2.6, mats.wall);
  box(-2, -26, 4, 4, 1.3, mats.crate); box(-1, -26, 4, 4, 1.3, mats.crate, { y: 1.3 });
  box(18, -24, 6, 6, 3, mats.wallDark);
  box(10, -14, 4, 4, 2.6, mats.crateBlue);

  // South lane ("the Tunnels"): containers and crate stacks.
  box(-12, 20, 12, 2, 2.6, mats.wall);
  box(8, 21, 10, 2, 2.6, mats.rust);
  box(16, 18, 8, 3, 3, mats.crateBlue);
  box(-20, 26, 4, 4, 1.3, mats.crate); box(-19, 26, 4, 4, 1.3, mats.crate, { y: 1.3 });

  // Mid connectors and yard cover.
  box(-16, -8, 2, 8, WALL_H, mats.wall);
  box(-16, 10, 2, 8, WALL_H, mats.wallDark);
  box(12, 12, 6, 2, 2.6, mats.rust);
  box(15, -2, 2, 6, WALL_H, mats.wall);
  box(-24, -8, 4, 2, 1.3, mats.crate);
  box(20, 6, 4, 2, 1.3, mats.crateBlue);
  box(-4, -16, 2, 6, WALL_H, mats.wallDark);
  box(-4, 16, 2, 6, WALL_H, mats.wall);
  barrel(-20, -13, mats.rust); barrel(-19.2, -14.2, mats.steel);
  barrel(12, -6, mats.rust); barrel(22, 14, mats.steel); barrel(21.2, 15.1, mats.rust);
  barrel(-26, 8, mats.steel); barrel(4, -13, mats.rust);

  // Lamp posts: emissive heads and warm pools of light (no shadows, cheap).
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x11100c, emissive: 0xffc37a, emissiveIntensity: 3 });
  for (const [lx, lz] of [[-22, -2], [0, -20], [18, -8], [-6, 20], [10, 2]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 6), mats.dark);
    pole.position.set(lx, 2.3, lz);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), lampMat);
    head.position.set(lx, 4.65, lz);
    scene.add(head);
    const pl = new THREE.PointLight(0xffc37a, 12, 13, 1.9);
    pl.position.set(lx, 4.4, lz);
    scene.add(pl);
  }

  // Distant skyline silhouettes so the yard does not end at the fence.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const d = 62 + (i % 3) * 9;
    const h = 8 + ((i * 7) % 13);
    const s = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), mats.dark);
    s.position.set(Math.cos(a) * d, h / 2 - 0.5, Math.sin(a) * d);
    scene.add(s);
  }

  const nodes = [
    [-30, 2], [-22, -2], [-22, -16], [-10, -20], [2, -20], [14, -18], [18, -8],
    [24, -8], [30, -2], [-22, 14], [-6, 20], [2, 20], [14, 16], [20, 2],
    [-13, 0], [-4, 0], [4, 0], [0, -5], [0, 5], [-2, -14], [30, -14], [10, 8],
  ].map(([x, z]) => new THREE.Vector2(x, z));
  const edges = [
    [0, 1], [0, 9], [1, 2], [1, 9], [1, 14], [2, 3], [3, 4], [3, 19], [4, 5],
    [4, 19], [5, 6], [5, 20], [6, 7], [6, 8], [7, 8], [8, 20], [9, 10], [9, 14],
    [10, 11], [10, 18], [11, 12], [12, 13], [12, 21], [13, 6], [13, 21],
    [14, 15], [15, 17], [15, 18], [16, 17], [16, 18], [16, 6], [16, 21], [19, 17],
  ];
  const graph = nodes.map(() => []);
  for (const [a, b] of edges) { graph[a].push(b); graph[b].push(a); }

  return {
    colliders,
    nodes,
    graph,
    site: SITE,
    spawns: {
      atk: [[-31, 0], [-31, 4], [-30, -3], [-29, 7], [-32, -6]],
      def: [[30, -3], [31, 1], [29, -13], [32, -8], [28, 2]],
    },
    update(t) { for (const fn of dynamics) fn(t); },
  };
}

// Push a circle (x, z, radius r) out of every collider; returns [x, z].
export function collideCircle(colliders, x, z, r) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const left = x - c.minX, right = c.maxX - x, top = z - c.minZ, bot = c.maxZ - z;
      const m = Math.min(left, right, top, bot);
      if (m === left) x = c.minX - r;
      else if (m === right) x = c.maxX + r;
      else if (m === top) z = c.minZ - r;
      else z = c.maxZ + r;
    }
  }
  return [x, z];
}

// 2D line of sight: true when the segment crosses a sight-blocking collider.
export function sightBlocked(colliders, ax, az, bx, bz) {
  for (const c of colliders) {
    if (!c.sight) continue;
    if (segmentHitsBox(ax, az, bx, bz, c)) return true;
  }
  return false;
}

export function segmentHitsBox(ax, az, bx, bz, c) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) return false; }
  else {
    let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) return false; }
  else {
    let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// Shortest path over the waypoint graph (BFS); returns node indices or null.
export function findPath(graph, nodes, fromIdx, toIdx) {
  if (fromIdx === toIdx) return [fromIdx];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [fromIdx];
  prev[fromIdx] = fromIdx;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of graph[cur]) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === toIdx) {
        const path = [toIdx];
        let p = toIdx;
        while (p !== fromIdx) { p = prev[p]; path.unshift(p); }
        return path;
      }
      queue.push(nb);
    }
  }
  return null;
}

export function nearestNode(nodes, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const dx = nodes[i].x - x, dz = nodes[i].y - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
