// Family Island — Heart Hunt. A small Three.js game built on the Blender scene.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const ROUND_SECONDS = 60;
const LIVES = 3;
const PLAYER_SPEED = 2.6;
const PLAYER_RADIUS = 0.18;
const ISLAND_RADIUS = 6.3;
const MAX_HEARTS = 4;
const GOLD_CHANCE = 0.12;
const COMBO_WINDOW = 2.0;
const COCONUT_FALL_TIME = 1.0;
const COCONUT_DROP_HEIGHT = 7;
const params = new URLSearchParams(location.search);

// ---------- Renderer, scene, camera ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc3f0);
scene.fog = new THREE.Fog(0x8fc3f0, 14, 30);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(6, 5, 9);

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5d7f36, 1.4));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
sun.position.set(5, 9, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
sun.shadow.bias = -0.0005;
scene.add(sun);

// The sea around the island.
const sea = new THREE.Mesh(
  new THREE.CircleGeometry(60, 48),
  new THREE.MeshStandardMaterial({ color: 0x2f9fd8, roughness: 0.35 })
);
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.25;
scene.add(sea);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $("hud"), score: $("score"), timer: $("timer"), lives: $("lives"), combo: $("combo"),
  menu: $("menu"), play: $("play"), bestMenu: $("best-menu"),
  over: $("over"), overTitle: $("over-title"), final: $("final"), bestOver: $("best-over"), again: $("again"),
  popups: $("popups"), joystick: $("joystick"), knob: $("knob"),
};
const bestScore = () => Number(localStorage.getItem("familyIslandBest") || 0);
function showBest() {
  const b = bestScore();
  ui.bestMenu.textContent = b ? `Best: ${b}` : "";
}

// ---------- Sound (tiny WebAudio synth, no files) ----------
let audio = null;
function beep(freq, dur = 0.12, type = "sine", vol = 0.15, when = 0) {
  if (!audio) return;
  const t = audio.currentTime + when;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur);
}
const sfx = {
  heart: (combo) => { beep(660 + combo * 60, 0.1); beep(990 + combo * 60, 0.14, "sine", 0.12, 0.07); },
  gold: () => [784, 988, 1175, 1568].forEach((f, i) => beep(f, 0.16, "triangle", 0.12, i * 0.06)),
  bonk: () => { beep(140, 0.25, "square", 0.12); beep(90, 0.3, "sawtooth", 0.08, 0.05); },
  thud: () => beep(70, 0.12, "triangle", 0.1),
  end: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, "triangle", 0.12, i * 0.12)),
};

// ---------- Input ----------
const keys = new Set();
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
addEventListener("keyup", (e) => keys.delete(e.code));

const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
canvas.addEventListener("pointerdown", (e) => {
  if (state.mode !== "playing" || stick.id !== null) return;
  stick.id = e.pointerId;
  stick.ox = e.clientX; stick.oy = e.clientY; stick.x = 0; stick.y = 0;
  ui.joystick.style.left = `${e.clientX}px`;
  ui.joystick.style.top = `${e.clientY}px`;
  ui.knob.style.transform = "";
  ui.joystick.classList.remove("hidden");
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const len = Math.hypot(dx, dy), max = 50;
  if (len > max) { dx *= max / len; dy *= max / len; }
  ui.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const mag = Math.min(len, max) / max;
  stick.x = len > 6 ? (dx / max) : 0;
  stick.y = len > 6 ? (dy / max) : 0;
  if (mag < 0.12) stick.x = stick.y = 0;
});
function releaseStick(e) {
  if (e.pointerId !== stick.id) return;
  stick.id = null; stick.x = stick.y = 0;
  ui.joystick.classList.add("hidden");
}
canvas.addEventListener("pointerup", releaseStick);
canvas.addEventListener("pointercancel", releaseStick);

function inputVector() {
  let x = stick.x, z = stick.y;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) z -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) z += 1;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return new THREE.Vector2(x, z);
}

// ---------- World state ----------
const state = {
  mode: "loading",          // loading | menu | playing | over
  score: 0, lives: LIVES, time: ROUND_SECONDS, elapsed: 0,
  combo: 0, lastPickup: -10, invuln: 0, stun: 0,
  nextCoconut: 3, shake: 0,
};
const world = {
  player: null, playerStart: new THREE.Vector3(), arms: {},
  circles: [], boxes: [],
  heartTemplate: null, coconutTemplate: null,
  hearts: [], coconuts: [],
  mixer: null,
  occluders: [],            // tree meshes that fade when they hide Dad
};
const goldMaterial = new THREE.MeshStandardMaterial({
  color: 0xffc83d, emissive: 0xb07800, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.4,
});
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.6, depthWrite: false });

// ---------- Load the island ----------
// GLTFLoader turns spaces in node names into underscores.
const byName = (obj, name) => obj.getObjectByName(name.replace(/ /g, "_"));

new GLTFLoader().load("assets/island.glb", (gltf) => {
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  scene.add(root);
  root.updateMatrixWorld(true);

  // Every family member waves except Dad, who becomes the player.
  world.mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations) {
    if (!clip.name.startsWith("Dad")) world.mixer.clipAction(clip).play();
  }

  const dad = byName(root, "Dad");
  scene.attach(dad); // keep its world transform, leave the Family group
  dad.position.y = 0;
  world.player = dad;
  world.playerStart.copy(dad.position);
  for (const side of [-1, 1]) {
    const arm = byName(dad, `Dad Arm ${side}`);
    if (arm) {
      arm.rotation.set(0, 0, side * THREE.MathUtils.degToRad(4)); // hanging, not waving
      world.arms[side] = arm;
    }
  }

  // Templates for spawned hearts and coconuts.
  const heart = byName(root, "Heart");
  world.heartTemplate = heart.clone();
  world.heartTemplate.scale.setScalar(1);
  world.heartTemplate.position.set(0, 0, 0);
  world.heartTemplate.rotation.set(0, 0, 0);
  const nut = byName(root, "Palm 1 Coconut 0");
  world.coconutTemplate = nut.clone();
  world.coconutTemplate.position.set(0, 0, 0);
  world.coconutTemplate.scale.setScalar(2.2);

  buildColliders(root);

  // Trees get their own material copies so each one can fade on its own.
  root.traverse((o) => {
    if (o.isMesh && /^(Palm|Tree)_\d+_(Trunk|Frond|Leaves)/.test(o.name)) {
      o.material = o.material.clone();
      o.material.transparent = true;
      o.userData.fade = 1;
      world.occluders.push(o);
    }
  });

  state.mode = "menu";
  ui.play.disabled = false;
  ui.play.textContent = "Play";
  showBest();
  if (params.has("autostart")) startGame();
}, undefined, (err) => {
  ui.play.textContent = "Couldn't load the island";
  console.error(err);
});

function buildColliders(root) {
  const v = new THREE.Vector3();
  const box = new THREE.Box3();
  // House body (plus the trim on its walls).
  world.boxes.push({ minX: -1.6, maxX: 1.6, minZ: -1.3, maxZ: 1.32 });

  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/Trunk$/.test(o.name)) {
      // A trunk's base: the average of its lowest vertices (palms lean, so not the box centre).
      const pos = o.geometry.attributes.position;
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y < 0.25) { sx += v.x; sz += v.z; n++; }
      }
      if (n) world.circles.push({ x: sx / n, z: sz / n, r: /Palm/.test(o.name) ? 0.2 : 0.16 });
    } else if (/^Bush_\d$/.test(o.name)) {
      box.setFromObject(o);
      box.getCenter(v);
      world.circles.push({ x: v.x, z: v.z, r: (box.max.x - box.min.x) / 2 });
    }
  });

  // The truck: three circles along its length.
  const truck = byName(root, "Red Truck");
  const tq = truck.getWorldQuaternion(new THREE.Quaternion());
  const tp = truck.getWorldPosition(new THREE.Vector3());
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(tq);
  for (const t of [-0.8, 0, 0.8]) {
    world.circles.push({ x: tp.x + axis.x * t, z: tp.z + axis.z * t, r: 0.6 });
  }

  for (const name of ["Mom", "Daughter", "Son"]) {
    byName(root, name).getWorldPosition(v);
    world.circles.push({ x: v.x, z: v.z, r: 0.2 });
  }
}

function collide(p, radius) {
  for (const c of world.circles) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + radius;
    if (d < min && d > 1e-6) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
  }
  for (const b of world.boxes) {
    const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
    const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d < radius) {
      if (d > 1e-6) { p.x = cx + (dx / d) * radius; p.z = cz + (dz / d) * radius; }
      else { p.z = b.maxZ + radius; } // inside: pop out the front
    }
  }
  const r = Math.hypot(p.x, p.z);
  if (r > ISLAND_RADIUS) { p.x *= ISLAND_RADIUS / r; p.z *= ISLAND_RADIUS / r; }
}

function isFree(x, z, margin) {
  if (Math.hypot(x, z) > ISLAND_RADIUS - 0.5) return false;
  for (const c of world.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return false;
  for (const b of world.boxes) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return false;
  }
  return true;
}

// ---------- Hearts ----------
function spawnHeart() {
  for (let tries = 0; tries < 40; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (ISLAND_RADIUS - 0.7);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!isFree(x, z, 0.45)) continue;
    if (world.player && Math.hypot(x - world.player.position.x, z - world.player.position.z) < 1.6) continue;
    const gold = Math.random() < GOLD_CHANCE;
    const mesh = world.heartTemplate.clone();
    if (gold) mesh.traverse((o) => { if (o.isMesh) o.material = goldMaterial; });
    mesh.position.set(x, 0.45, z);
    mesh.scale.setScalar(0.01);
    scene.add(mesh);
    world.hearts.push({ mesh, gold, age: 0, phase: Math.random() * 6 });
    return;
  }
}

function updateHearts(dt) {
  const p = world.player.position;
  for (let i = world.hearts.length - 1; i >= 0; i--) {
    const h = world.hearts[i];
    h.age += dt;
    const grow = Math.min(1, h.age * 4);
    const s = (h.gold ? 2.0 : 1.6) * grow;
    h.mesh.scale.setScalar(s);
    h.mesh.rotation.y += dt * 2;
    h.mesh.position.y = 0.45 + Math.sin(h.age * 3 + h.phase) * 0.06;
    if (state.mode === "playing" && Math.hypot(h.mesh.position.x - p.x, h.mesh.position.z - p.z) < 0.45) {
      collectHeart(h);
      scene.remove(h.mesh);
      world.hearts.splice(i, 1);
    }
  }
  while (state.mode === "playing" && world.hearts.length < MAX_HEARTS) spawnHeart();
}

function collectHeart(h) {
  state.combo = state.elapsed - state.lastPickup < COMBO_WINDOW ? Math.min(state.combo + 1, 5) : 1;
  state.lastPickup = state.elapsed;
  const base = h.gold ? 5 : 1;
  const points = base * state.combo;
  state.score += points;
  if (h.gold) { state.time += 3; sfx.gold(); } else sfx.heart(state.combo);
  const label = `+${points}${state.combo > 1 ? `  x${state.combo}` : ""}${h.gold ? "  +3s" : ""}`;
  popup(h.mesh.position, label, h.gold ? "gold" : "");
}

// ---------- Coconuts ----------
function spawnCoconut() {
  const p = world.player.position;
  let x, z;
  for (let tries = 0; tries < 20; tries++) {
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.3;
      x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
    } else {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (ISLAND_RADIUS - 0.3);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    if (Math.hypot(x, z) < ISLAND_RADIUS && isFree(x, z, 0.05)) break;
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.42, 24), ringMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.03, z);
  const nut = world.coconutTemplate.clone();
  nut.position.set(x, COCONUT_DROP_HEIGHT, z);
  scene.add(ring, nut);
  world.coconuts.push({ ring, nut, t: 0, landed: false, vx: 0, vz: 0 });
}

function updateCoconuts(dt) {
  const p = world.player.position;
  for (let i = world.coconuts.length - 1; i >= 0; i--) {
    const c = world.coconuts[i];
    c.t += dt;
    if (!c.landed) {
      const k = Math.min(1, c.t / COCONUT_FALL_TIME);
      c.nut.position.y = COCONUT_DROP_HEIGHT * (1 - k * k) + 0.15;
      c.nut.rotation.x += dt * 8;
      c.ring.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(c.t * 10));
      c.ring.scale.setScalar(1.2 - 0.4 * k);
      if (k >= 1) {
        c.landed = true;
        c.t = 0;
        scene.remove(c.ring);
        sfx.thud();
        const dx = p.x - c.nut.position.x, dz = p.z - c.nut.position.z;
        if (state.mode === "playing" && Math.hypot(dx, dz) < 0.45 && state.invuln <= 0) hitPlayer();
        const a = Math.random() * Math.PI * 2;
        c.vx = Math.cos(a) * 0.8; c.vz = Math.sin(a) * 0.8;
      }
    } else {
      // Roll a little, then sink away.
      c.nut.position.x += c.vx * dt; c.nut.position.z += c.vz * dt;
      c.vx *= 0.92; c.vz *= 0.92;
      if (c.t > 1.2) c.nut.position.y -= dt * 0.6;
      if (c.t > 1.8) { scene.remove(c.nut); world.coconuts.splice(i, 1); }
    }
  }
}

function hitPlayer() {
  state.lives -= 1;
  state.invuln = 1.6;
  state.stun = 0.5;
  state.shake = 0.35;
  state.combo = 0;
  sfx.bonk();
  popup(world.player.position, "Bonk!", "bad");
  renderLives();
  if (state.lives <= 0) endGame("Bonk! Out of lives");
}

// ---------- Player ----------
const moveDir = new THREE.Vector3();
let walkPhase = 0;
function updatePlayer(dt) {
  const dad = world.player;
  const input = state.mode === "playing" && state.stun <= 0 ? inputVector() : new THREE.Vector2();
  const moving = input.lengthSq() > 0.0001;
  if (moving) {
    moveDir.set(input.x, 0, input.y);
    dad.position.addScaledVector(moveDir, PLAYER_SPEED * dt);
    collide(dad.position, PLAYER_RADIUS);
    const yaw = Math.atan2(moveDir.x, moveDir.z); // Dad's front is +z
    let diff = yaw - dad.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    dad.rotation.y += diff * Math.min(1, dt * 12);
    walkPhase += dt * 11 * input.length();
  } else {
    walkPhase += (Math.round(walkPhase / Math.PI) * Math.PI - walkPhase) * Math.min(1, dt * 10);
  }
  dad.position.y = Math.abs(Math.sin(walkPhase)) * 0.045;
  dad.rotation.z = Math.sin(walkPhase) * 0.05;
  for (const side of [-1, 1]) {
    const arm = world.arms[side];
    if (arm) arm.rotation.x = Math.sin(walkPhase) * 0.5 * side;
  }
  // Blink while invulnerable.
  dad.visible = state.invuln > 0 ? Math.floor(state.invuln * 12) % 2 === 0 : true;
}

// ---------- Camera ----------
const camTarget = new THREE.Vector3();
const lookAt = new THREE.Vector3();
let orbit = 0;
function updateCamera(dt) {
  if (state.mode === "playing" || state.mode === "over") {
    const p = world.player.position;
    const portrait = camera.aspect < 1;
    camTarget.set(p.x * 0.85, portrait ? 7.0 : 5.0, p.z + (portrait ? 6.0 : 4.8));
    camera.position.lerp(camTarget, 1 - Math.exp(-dt * 4));
    lookAt.lerp(new THREE.Vector3(p.x, 0.4, p.z - 0.3), 1 - Math.exp(-dt * 6));
  } else {
    // Menu: slow orbit around the island.
    orbit += dt * 0.12;
    const r = camera.aspect < 1 ? 13 : 10;
    camera.position.set(Math.sin(orbit) * r + 0.5, 4.2, Math.cos(orbit) * r);
    lookAt.set(0.5, 1, 0.5);
  }
  if (state.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * state.shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * state.shake * 0.4;
  }
  camera.lookAt(lookAt);
  if (world.player && (state.mode === "playing" || state.mode === "over")) fadeOccluders(dt);
}

// Fade any tree standing between the camera and Dad.
const raycaster = new THREE.Raycaster();
const rayTarget = new THREE.Vector3();
function fadeOccluders(dt) {
  const hidden = new Set();
  const p = world.player.position;
  for (const h of [0.15, 0.5, 0.9]) {
    rayTarget.set(p.x, p.y + h, p.z);
    const dir = rayTarget.clone().sub(camera.position);
    raycaster.set(camera.position, dir.normalize());
    raycaster.far = camera.position.distanceTo(rayTarget) - 0.2;
    for (const hit of raycaster.intersectObjects(world.occluders, false)) hidden.add(hit.object);
  }
  // Fade the whole tree, not just the frond the ray touched.
  const prefixes = new Set([...hidden].map((o) => o.name.match(/^(Palm|Tree)_\d+/)[0]));
  for (const o of world.occluders) {
    const prefix = o.name.match(/^(Palm|Tree)_\d+/)[0];
    const target = prefixes.has(prefix) ? 0.22 : 1;
    o.userData.fade += (target - o.userData.fade) * Math.min(1, dt * 8);
    o.material.opacity = o.userData.fade;
    o.material.depthWrite = o.userData.fade > 0.95;
  }
}

// ---------- HUD ----------
function renderLives() {
  ui.lives.textContent = "❤️".repeat(Math.max(0, state.lives)) + "🤍".repeat(Math.max(0, LIVES - state.lives));
}
function renderHud() {
  ui.score.textContent = state.score;
  const t = Math.max(0, Math.ceil(state.time));
  ui.timer.textContent = t;
  ui.timer.classList.toggle("low", t <= 10);
  const comboOn = state.combo > 1 && state.elapsed - state.lastPickup < COMBO_WINDOW;
  ui.combo.textContent = comboOn ? `Combo x${state.combo}` : "";
  ui.combo.classList.toggle("on", comboOn);
}

const projected = new THREE.Vector3();
function popup(worldPos, text, cls) {
  projected.copy(worldPos).setY(worldPos.y + 0.6).project(camera);
  const el = document.createElement("div");
  el.className = `popup ${cls}`;
  el.textContent = text;
  el.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
  ui.popups.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ---------- Game flow ----------
function clearField() {
  for (const h of world.hearts) scene.remove(h.mesh);
  for (const c of world.coconuts) scene.remove(c.nut, c.ring);
  world.hearts.length = 0;
  world.coconuts.length = 0;
}

function startGame() {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  }
  audio?.resume?.();
  clearField();
  Object.assign(state, {
    mode: "playing", score: 0, lives: LIVES, time: ROUND_SECONDS, elapsed: 0,
    combo: 0, lastPickup: -10, invuln: 0, stun: 0, nextCoconut: 3, shake: 0,
  });
  const dad = world.player;
  dad.position.copy(world.playerStart);
  dad.rotation.set(0, 0, 0);
  dad.visible = true;
  camera.position.set(dad.position.x, 7, dad.position.z + 6);
  lookAt.set(dad.position.x, 0.4, dad.position.z);
  ui.menu.classList.add("hidden");
  ui.over.classList.add("hidden");
  ui.hud.classList.remove("hidden");
  renderLives();
  renderHud();
}

function endGame(title) {
  if (state.mode !== "playing") return;
  state.mode = "over";
  stick.id = null; stick.x = stick.y = 0;
  ui.joystick.classList.add("hidden");
  const prev = bestScore();
  const best = Math.max(prev, state.score);
  localStorage.setItem("familyIslandBest", best);
  ui.overTitle.textContent = title;
  ui.final.textContent = state.score;
  ui.bestOver.textContent = state.score > prev && state.score > 0 ? "New best score!" : `Best: ${best}`;
  sfx.end();
  setTimeout(() => ui.over.classList.remove("hidden"), 600);
}

ui.play.addEventListener("click", startGame);
ui.again.addEventListener("click", startGame);
addEventListener("keydown", (e) => {
  if ((e.code === "Enter" || e.code === "Space") && (state.mode === "menu" || state.mode === "over")) startGame();
});

// Test hook: ?debug exposes the game state (used by the automated play test).
if (params.has("debug")) window.__game = { state, world, startGame };

// ---------- Main loop ----------
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (world.mixer) world.mixer.update(dt);

  if (world.player) {
    if (state.mode === "playing") {
      state.elapsed += dt;
      state.time -= dt;
      state.invuln = Math.max(0, state.invuln - dt);
      state.stun = Math.max(0, state.stun - dt);
      state.nextCoconut -= dt;
      if (state.nextCoconut <= 0) {
        spawnCoconut();
        state.nextCoconut = Math.max(0.45, 1.4 - state.elapsed * 0.016) * (0.7 + Math.random() * 0.6);
      }
      if (state.time <= 0) { state.time = 0; endGame("Time's up!"); }
      renderHud();
    }
    state.shake = Math.max(0, state.shake - dt);
    updatePlayer(dt);
    updateHearts(dt);
    updateCoconuts(dt);
  }
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
