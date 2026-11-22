// Family Island — Heart Hunt. Three.js game on the low-poly Blender island,
// restyled as an architectural axonometric, with a stylised dark-skinned family.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeCharacter, FAMILY } from "./characters.js";
import { buildWorld, groundHeight, walkable, makeHeart } from "./world.js";

const ROUND_SECONDS = 60;
const LIVES = 3;
const RUN_SPEED = 2.7;
const ACCEL = 9;
const PLAYER_RADIUS = 0.16;
const MAX_HEARTS = 4;
const GOLD_CHANCE = 0.12;
const COMBO_WINDOW = 2.0;
const COCONUT_FALL_TIME = 1.0;
const COCONUT_DROP_HEIGHT = 7;
const CAM_DIR = new THREE.Vector3(5, 10, 9).normalize(); // axonometric view from the south-east
const params = new URLSearchParams(location.search);

// ---------- Renderer, scene, camera ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
let pixelRatio = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7cc7d2);

const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 120);

// Soft, bright daylight: big sky fill plus a warm sun casting soft shadows to the north-east.
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c9b6, 1.55));
const sun = new THREE.DirectionalLight(0xfff1de, 2.1);
sun.position.set(-7, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun);

// Post: ambient occlusion for the soft rendered look (switched off on slow devices).
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
let aoPass = null;
if (params.get("ao") !== "0") {
  try {
    aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
    aoPass.output = GTAOPass.OUTPUT.Default;
    aoPass.blendIntensity = 0.85;
    aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
    composer.addPass(aoPass);
  } catch (e) {
    console.warn("AO unavailable", e);
    aoPass = null;
  }
}
composer.addPass(new OutputPass());

let viewHeight = 8;
function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $("hud"), score: $("score"), timer: $("timer"), lives: $("lives"), combo: $("combo"),
  menu: $("menu"), play: $("play"), bestMenu: $("best-menu"), lede: $("lede"),
  over: $("over"), overTitle: $("over-title"), final: $("final"), bestOver: $("best-over"),
  again: $("again"), change: $("change"),
  popups: $("popups"), joystick: $("joystick"), knob: $("knob"),
  heroButtons: [...document.querySelectorAll(".hero")],
};
const bestScore = () => Number(localStorage.getItem("familyIslandBest") || 0);

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

// ---------- Input (keys + drag-anywhere joystick) ----------
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
  stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0;
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
  const dead = len < 6;
  stick.x = dead ? 0 : dx / max;
  stick.y = dead ? 0 : dy / max;
});
function releaseStick(e) {
  if (e.pointerId !== stick.id) return;
  stick.id = null; stick.x = stick.y = 0;
  ui.joystick.classList.add("hidden");
}
canvas.addEventListener("pointerup", releaseStick);
canvas.addEventListener("pointercancel", releaseStick);

// Screen-space input turned into a ground direction relative to the camera.
const camForward = new THREE.Vector3(-CAM_DIR.x, 0, -CAM_DIR.z).normalize();
const camRight = new THREE.Vector3(-camForward.z, 0, camForward.x);
function inputDirection() {
  let x = stick.x, y = stick.y;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
  if (keys.has("KeyW") || keys.has("ArrowUp")) y -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) y += 1;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return camRight.clone().multiplyScalar(x).addScaledVector(camForward, -y);
}

// ---------- State ----------
const state = {
  mode: "loading",          // loading | menu | playing | over
  hero: localStorage.getItem("familyIslandHero") === "M" ? "M" : "JM",
  score: 0, lives: LIVES, time: ROUND_SECONDS, elapsed: 0,
  combo: 0, lastPickup: -10, invuln: 0, stun: 0, nextCoconut: 3, shake: 0,
};
const world = {
  env: null, characters: {}, player: null, playerChar: null, npcs: [],
  velocity: new THREE.Vector3(), yaw: 0, turnRate: 0,
  circles: [], npcCircles: [], boxes: [],
  hearts: [], coconuts: [], occluders: [],
};
const goldMaterial = new THREE.MeshStandardMaterial({
  color: 0xffc83d, emissive: 0x8a5a00, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.45,
});
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xe8612c, transparent: true, opacity: 0.7, depthWrite: false });
const coconutGeo = new THREE.IcosahedronGeometry(0.11, 0);
const coconutMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, flatShading: true });

// ---------- Load ----------
const manager = THREE.DefaultLoadingManager;
let islandRoot = null;
new GLTFLoader().load("assets/island.glb", (gltf) => {
  islandRoot = gltf.scene;
  scene.add(islandRoot);
}, undefined, (err) => {
  ui.play.textContent = "Couldn't load the island";
  console.error(err);
});

// Everything (island + textures) has arrived.
manager.onLoad = () => {
  if (state.mode !== "loading" || !islandRoot) return;
  setupWorld();
  renderPortraits();
  state.mode = "menu";
  ui.play.disabled = false;
  ui.play.textContent = "Play";
  selectHero(state.hero);
  showBest();
  if (params.has("autostart")) startGame(params.get("hero") === "M" ? "M" : state.hero);
};

function setupWorld() {
  world.env = buildWorld(scene, islandRoot);
  world.circles = world.env.circles;
  world.boxes = world.env.boxes;
  // Each faded object gets its own material so groups fade independently.
  for (const o of world.env.occluders) {
    o.material = o.material.clone();
    o.material.transparent = true;
    o.userData.fade = 1;
  }
  world.occluders = world.env.occluders;
  for (const name of ["JM", "M", "N", "H"]) {
    const c = makeCharacter(FAMILY[name]);
    scene.add(c.root);
    world.characters[name] = c;
  }
  placeFamily(state.hero);
}

// Put the chosen hero at the start and everyone else by the front door.
function placeFamily(hero) {
  const { spots } = world.env;
  const other = hero === "JM" ? "M" : "JM";
  const faceCam = Math.atan2(CAM_DIR.x, CAM_DIR.z);
  const place = (c, p, yaw) => {
    c.root.position.set(p.x, groundHeight(p.x, p.z), p.z);
    c.root.rotation.set(0, yaw, 0);
    c.root.visible = true;
  };
  place(world.characters[other], spots.adult, faceCam - 0.25);
  place(world.characters.N, spots.kids[0], faceCam);
  place(world.characters.H, spots.kids[1], faceCam + 0.2);
  world.playerChar = world.characters[hero];
  world.player = world.playerChar.root;
  place(world.playerChar, spots.player, faceCam);
  world.yaw = faceCam;
  world.npcs = [world.characters[other], world.characters.N, world.characters.H];
  world.npcCircles = world.npcs.map((c) => ({ x: c.root.position.x, z: c.root.position.z, r: 0.17 }));
}

// ---------- Hero picker ----------
function selectHero(name) {
  state.hero = name;
  localStorage.setItem("familyIslandHero", name);
  ui.heroButtons.forEach((b) => b.classList.toggle("selected", b.dataset.hero === name));
  const others = name === "JM" ? "M, N &amp; H" : "JM, N &amp; H";
  ui.lede.innerHTML = `Help <b>${name}</b> collect hearts for <b>${others}</b>. Dodge the coconuts falling on the orange rings.`;
  if (state.mode === "menu") placeFamily(name);
}
ui.heroButtons.forEach((b) => b.addEventListener("click", () => selectHero(b.dataset.hero)));

// Little portraits of the two heroes for the menu.
function renderPortraits() {
  const w = 220, h = 260;
  const pr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  pr.setPixelRatio(2);
  pr.setSize(w, h);
  pr.toneMapping = THREE.NeutralToneMapping;
  for (const name of ["JM", "M"]) {
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight(0xffffff, 0xcdbfae, 1.7));
    const key = new THREE.DirectionalLight(0xfff1de, 2.0);
    key.position.set(-1, 2, 3);
    s.add(key);
    const c = makeCharacter(FAMILY[name]);
    c.update(0.016, "idle");
    s.add(c.root);
    const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, 20);
    const top = FAMILY[name].height;
    cam.position.set(0.35, top * 0.82, 1.9);
    cam.lookAt(0, top * 0.62, 0);
    pr.render(s, cam);
    const img = document.getElementById(`portrait-${name}`);
    if (img) img.src = pr.domElement.toDataURL("image/png");
  }
  pr.dispose();
}

// ---------- Collisions ----------
function collide(p, radius) {
  for (const list of [world.circles, world.npcCircles]) {
    for (const c of list) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + radius;
      if (d < min && d > 1e-6) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
    }
  }
  for (const b of world.boxes) {
    const cx = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
    const cz = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d < radius) {
      if (d > 1e-6) { p.x = cx + (dx / d) * radius; p.z = cz + (dz / d) * radius; }
      else p.z = b.maxZ + radius;
    }
  }
}

function isFree(x, z, margin) {
  if (!walkable(x, z)) return false;
  for (const list of [world.circles, world.npcCircles]) {
    for (const c of list) if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return false;
  }
  for (const b of world.boxes) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return false;
  }
  return true;
}

// ---------- Hearts ----------
function spawnHeart() {
  for (let tries = 0; tries < 60; tries++) {
    const x = (Math.random() * 2 - 1) * 7.5, z = (Math.random() * 2 - 1) * 7.5;
    if (!isFree(x, z, 0.4)) continue;
    if (Math.hypot(x - world.player.position.x, z - world.player.position.z) < 1.6) continue;
    const gold = Math.random() < GOLD_CHANCE;
    const mesh = makeHeart(gold ? 0.36 : 0.3, gold ? goldMaterial : world.env.heartMat);
    const base = groundHeight(x, z) + 0.42;
    mesh.position.set(x, base, z);
    mesh.scale.setScalar(0.01);
    scene.add(mesh);
    world.hearts.push({ mesh, gold, age: 0, base, phase: Math.random() * 6 });
    return;
  }
}

function updateHearts(dt) {
  const p = world.player.position;
  for (let i = world.hearts.length - 1; i >= 0; i--) {
    const h = world.hearts[i];
    h.age += dt;
    h.mesh.scale.setScalar(Math.min(1, h.age * 4));
    h.mesh.rotation.y += dt * 2;
    h.mesh.position.y = h.base + Math.sin(h.age * 3 + h.phase) * 0.06;
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
  const points = (h.gold ? 5 : 1) * state.combo;
  state.score += points;
  if (h.gold) { state.time += 3; sfx.gold(); } else sfx.heart(state.combo);
  popup(h.mesh.position, `+${points}${state.combo > 1 ? `  ×${state.combo}` : ""}${h.gold ? "  +3s" : ""}`, h.gold ? "gold" : "");
}

// ---------- Coconuts ----------
function spawnCoconut() {
  const p = world.player.position;
  let x = p.x, z = p.z;
  for (let tries = 0; tries < 30; tries++) {
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.3;
      x = p.x + Math.cos(a) * r; z = p.z + Math.sin(a) * r;
    } else {
      x = (Math.random() * 2 - 1) * 6.5; z = (Math.random() * 2 - 1) * 6.5;
    }
    if (isFree(x, z, 0.02)) break;
  }
  const gy = groundHeight(x, z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.38, 28), ringMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, gy + 0.02, z);
  const nut = new THREE.Mesh(coconutGeo, coconutMat);
  nut.castShadow = true;
  nut.position.set(x, gy + COCONUT_DROP_HEIGHT, z);
  scene.add(ring, nut);
  world.coconuts.push({ ring, nut, gy, t: 0, landed: false, vx: 0, vz: 0 });
}

function updateCoconuts(dt) {
  const p = world.player.position;
  for (let i = world.coconuts.length - 1; i >= 0; i--) {
    const c = world.coconuts[i];
    c.t += dt;
    if (!c.landed) {
      const k = Math.min(1, c.t / COCONUT_FALL_TIME);
      c.nut.position.y = c.gy + COCONUT_DROP_HEIGHT * (1 - k * k) + 0.1;
      c.nut.rotation.x += dt * 8;
      c.ring.material.opacity = 0.45 + 0.35 * Math.abs(Math.sin(c.t * 10));
      c.ring.scale.setScalar(1.25 - 0.45 * k);
      if (k >= 1) {
        c.landed = true;
        c.t = 0;
        scene.remove(c.ring);
        sfx.thud();
        if (state.mode === "playing" && state.invuln <= 0 &&
            Math.hypot(p.x - c.nut.position.x, p.z - c.nut.position.z) < 0.42) hitPlayer();
        const a = Math.random() * Math.PI * 2;
        c.vx = Math.cos(a) * 0.8; c.vz = Math.sin(a) * 0.8;
      }
    } else {
      c.nut.position.x += c.vx * dt; c.nut.position.z += c.vz * dt;
      c.vx *= 0.92; c.vz *= 0.92;
      if (c.t > 1.2) c.nut.position.y -= dt * 0.5;
      if (c.t > 1.8) { scene.remove(c.nut); world.coconuts.splice(i, 1); }
    }
  }
}

function hitPlayer() {
  state.lives -= 1;
  state.invuln = 1.6;
  state.stun = 0.45;
  state.shake = 0.3;
  state.combo = 0;
  world.velocity.multiplyScalar(0.2);
  sfx.bonk();
  popup(world.player.position, "Bonk!", "bad");
  renderLives();
  if (state.lives <= 0) endGame("Bonk! Out of lives");
}

// ---------- Player ----------
const desired = new THREE.Vector3();
function updatePlayer(dt) {
  const hero = world.player;
  const canMove = state.mode === "playing" && state.stun <= 0;
  desired.copy(canMove ? inputDirection() : new THREE.Vector3()).multiplyScalar(RUN_SPEED);
  // Ease into and out of the run instead of snapping to full speed.
  world.velocity.lerp(desired, 1 - Math.exp(-dt * ACCEL));
  const speed = world.velocity.length();

  if (speed > 0.01) {
    const next = hero.position.clone().addScaledVector(world.velocity, dt);
    collide(next, PLAYER_RADIUS);
    if (walkable(next.x, next.z)) hero.position.copy(next);
    else if (walkable(next.x, hero.position.z)) hero.position.x = next.x; // slide along the shore
    else if (walkable(hero.position.x, next.z)) hero.position.z = next.z;
  }
  hero.position.y = groundHeight(hero.position.x, hero.position.z);

  // Turn towards the direction of travel; remember the turn rate for banking.
  let turn = 0;
  if (speed > 0.15) {
    const target = Math.atan2(world.velocity.x, world.velocity.z);
    const diff = Math.atan2(Math.sin(target - world.yaw), Math.cos(target - world.yaw));
    const step = diff * Math.min(1, dt * 12);
    world.yaw += step;
    turn = step / Math.max(dt, 1e-4);
  }
  world.turnRate += (turn - world.turnRate) * Math.min(1, dt * 8);
  hero.rotation.y = world.yaw;
  world.playerChar.update(dt, "run", Math.min(1, speed / RUN_SPEED), world.turnRate);
  hero.visible = state.invuln > 0 ? Math.floor(state.invuln * 12) % 2 === 0 : true;
}

function updateNpcs(dt) {
  const p = world.player.position;
  world.npcs.forEach((c, i) => {
    const near = Math.hypot(c.root.position.x - p.x, c.root.position.z - p.z) < 2.6;
    // The kids always wave; the other parent waves when the hero comes close.
    const mode = i > 0 || near || state.mode !== "playing" ? "wave" : "idle";
    c.update(dt, mode);
  });
}

// ---------- Camera ----------
const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3(0, 0, 1);
let orbit = 0;
function updateCamera(dt) {
  const portrait = innerWidth < innerHeight;
  let vh, look, dir = CAM_DIR;
  if (state.mode === "playing" || state.mode === "over") {
    vh = portrait ? 6.2 : 4.8;
    look = new THREE.Vector3(world.player.position.x, 0.3, world.player.position.z);
  } else {
    // Menu: show the whole island, slowly turning.
    orbit += dt * 0.08;
    vh = portrait ? 17 : 12;
    look = new THREE.Vector3(0.6, 0, 1.0);
    dir = CAM_DIR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(orbit) * 0.5);
  }
  camLook.lerp(look, 1 - Math.exp(-dt * 5));
  const nextVh = viewHeight + (vh - viewHeight) * (1 - Math.exp(-dt * 3));
  if (Math.abs(nextVh - viewHeight) > 1e-4) { viewHeight = nextVh; resize(); }
  camTarget.copy(camLook).addScaledVector(dir, 30);
  camera.position.copy(camTarget);
  if (state.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * state.shake * 0.3;
    camera.position.z += (Math.random() - 0.5) * state.shake * 0.3;
  }
  camera.lookAt(camLook);
  if (world.player && (state.mode === "playing" || state.mode === "over")) fadeOccluders(dt);
}

// Fade whatever stands between the camera and the hero (palms, trees, the house).
const raycaster = new THREE.Raycaster();
function fadeOccluders(dt) {
  const hidden = new Set();
  const p = world.player.position;
  for (const h of [0.15, 0.5, 0.85]) {
    raycaster.set(new THREE.Vector3(p.x, p.y + h, p.z), CAM_DIR);
    raycaster.far = 40;
    for (const hit of raycaster.intersectObjects(world.occluders, false)) hidden.add(hit.object.userData.group);
  }
  for (const o of world.occluders) {
    const target = hidden.has(o.userData.group) ? 0.18 : 1;
    o.userData.fade += (target - o.userData.fade) * Math.min(1, dt * 8);
    o.material.opacity = o.userData.fade;
    o.material.depthWrite = o.userData.fade > 0.95;
  }
}

// ---------- HUD ----------
function renderLives() {
  ui.lives.innerHTML = Array.from({ length: LIVES }, (_, i) => `<i class="${i < state.lives ? "on" : ""}"></i>`).join("");
}
function renderHud() {
  ui.score.textContent = state.score;
  const t = Math.max(0, Math.ceil(state.time));
  ui.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  ui.timer.classList.toggle("low", t <= 10);
  const comboOn = state.combo > 1 && state.elapsed - state.lastPickup < COMBO_WINDOW;
  ui.combo.textContent = comboOn ? `Combo ×${state.combo}` : "";
  ui.combo.classList.toggle("on", comboOn);
}
function showBest() {
  const b = bestScore();
  ui.bestMenu.textContent = b ? `Best score — ${b}` : "";
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

function startGame(hero = state.hero) {
  if (!audio) {
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; }
  }
  audio?.resume?.();
  clearField();
  selectHero(hero);
  placeFamily(hero);
  Object.assign(state, {
    mode: "playing", score: 0, lives: LIVES, time: ROUND_SECONDS, elapsed: 0,
    combo: 0, lastPickup: -10, invuln: 0, stun: 0, nextCoconut: 3, shake: 0,
  });
  world.velocity.set(0, 0, 0);
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
  ui.bestOver.textContent = state.score > prev && state.score > 0 ? "New best score!" : `Best score — ${best}`;
  sfx.end();
  setTimeout(() => ui.over.classList.remove("hidden"), 600);
}

function backToMenu() {
  clearField();
  state.mode = "menu";
  ui.over.classList.add("hidden");
  ui.hud.classList.add("hidden");
  ui.menu.classList.remove("hidden");
  placeFamily(state.hero);
  showBest();
}

ui.play.addEventListener("click", () => startGame());
ui.again.addEventListener("click", () => startGame());
ui.change.addEventListener("click", backToMenu);
addEventListener("keydown", (e) => {
  if ((e.code === "Enter" || e.code === "Space") && (state.mode === "menu" || state.mode === "over")) startGame();
});

// Test hook: ?debug exposes the game state (used by the automated play test).
if (params.has("debug")) window.__game = { state, world, startGame };

// ---------- Main loop ----------
const clock = new THREE.Clock();
let elapsedTotal = 0;
let perfFrames = 0, perfTime = 0, perfChecked = false;
function tick() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 0.05);
  elapsedTotal += dt;

  if (world.env) {
    world.env.update(dt, elapsedTotal);
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
    updateNpcs(dt);
    updateHearts(dt);
    updateCoconuts(dt);
  }
  updateCamera(dt);
  composer.render(dt);

  // Keep it smooth on phones: if frames are slow, drop the AO and render resolution.
  if (!perfChecked && world.env) {
    perfFrames++; perfTime += raw;
    if (perfFrames === 120) {
      perfChecked = true;
      if (perfTime / perfFrames > 1 / 40 && !params.has("debug")) {
        if (aoPass) aoPass.enabled = false;
        pixelRatio = Math.min(pixelRatio, 1.25);
        resize();
      }
    }
  }
  requestAnimationFrame(tick);
}
tick();
