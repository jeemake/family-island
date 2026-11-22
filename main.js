// Family Island — Heart Hunt. Three.js game on the low-poly Blender island,
// restyled as an architectural axonometric, with a stylised dark-skinned family.
// Run, sprint and jump for hearts on land; take the boat out to fish.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { makeCharacter, FAMILY } from "./characters.js";
import { buildWorld, groundHeight, walkable, makeHeart, inPier, shoreRadius } from "./world.js";

const ROUND_SECONDS = 60;
const LIVES = 3;
const RUN_SPEED = 2.7;
const SPRINT_SPEED = 4.3;
const ACCEL = 9;
const GRAVITY = 12;
const JUMP_SPEED = 3.7;              // ~0.57 high: enough to clear a rolling coconut or reach a sky heart
const STAMINA_DRAIN = 30, STAMINA_REGEN = 22;
const DOUBLE_TAP_MS = 300;
const PLAYER_RADIUS = 0.16;
const MAX_HEARTS = 4;
const GOLD_CHANCE = 0.12;
const SKY_CHANCE = 0.25;
const COMBO_WINDOW = 2.0;
const COCONUT_FALL_TIME = 1.0;
const COCONUT_DROP_HEIGHT = 7;
const BOAT_SPEED = 3.2, BOAT_BOOST = 4.6, BOAT_MAX_R = 15;
const FISH_SPOTS = 3;
const FISH = [
  { key: "tang", name: "Blue tang", body: 0x2f6fd6, fin: 0xf2c94c, points: 3, weight: 0.5 },
  { key: "snapper", name: "Red snapper", body: 0xd9533b, fin: 0xf0a08c, points: 4, weight: 0.35 },
  { key: "koi", name: "Golden koi", body: 0xf2a93b, fin: 0xffe08a, points: 10, weight: 0.15, bonusTime: 5 },
];
const CAM_DIR = new THREE.Vector3(5, 10, 9).normalize(); // axonometric view from the south-east
const params = new URLSearchParams(location.search);
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

// ---------- Renderer, scene, camera ----------
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
let pixelRatio = Math.min(devicePixelRatio, 2);
renderer.setPixelRatio(pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7cc7d2);
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 120);

// Soft, bright daylight: big sky fill plus a warm sun casting soft shadows to the north-east.
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8c9b6, 1.55));
const sun = new THREE.DirectionalLight(0xfff1de, 2.1);
sun.position.set(-7, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 50 });
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
  hud: $("hud"), score: $("score"), tally: $("tally"), timer: $("timer"), lives: $("lives"), combo: $("combo"),
  stamina: $("stamina"), staminaFill: $("stamina-fill"), prompt: $("prompt"),
  catchCard: $("catch"), catchImg: $("catch-img"), catchText: $("catch-text"),
  btnMain: $("btn-main"), btnAlt: $("btn-alt"), touchButtons: $("touch-buttons"),
  menu: $("menu"), play: $("play"), bestMenu: $("best-menu"), lede: $("lede"),
  over: $("over"), overTitle: $("over-title"), final: $("final"), overTally: $("over-tally"), bestOver: $("best-over"),
  again: $("again"), change: $("change"),
  popups: $("popups"), joystick: $("joystick"), knob: $("knob"),
  heroButtons: [...document.querySelectorAll(".hero")],
  muteButtons: [...document.querySelectorAll(".mute")],
};
const bestScore = () => Number(localStorage.getItem("familyIslandBest") || 0);
if (isTouch) document.body.classList.add("touch");

// ---------- Audio: ElevenLabs music + effects, with tiny synth fallbacks ----------
const SOUNDS = ["heart", "gold", "jump", "land", "bonk", "thud", "board", "splash", "bite", "catch", "miss", "end", "engine", "waves", "music"];
const audio = { ctx: null, buffers: {}, master: null, music: null, sfx: null, engine: null, waves: null,
  muted: localStorage.getItem("familyIslandMuted") === "1" };

function initAudio() {
  if (audio.ctx) { audio.ctx.resume?.(); return; }
  try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  const ctx = audio.ctx;
  audio.master = ctx.createGain();
  audio.master.gain.value = audio.muted ? 0 : 1;
  audio.master.connect(ctx.destination);
  audio.music = ctx.createGain(); audio.music.gain.value = 0.32; audio.music.connect(audio.master);
  audio.sfx = ctx.createGain(); audio.sfx.gain.value = 0.85; audio.sfx.connect(audio.master);
  for (const name of SOUNDS) {
    fetch(`assets/audio/${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
      .then((buf) => {
        audio.buffers[name] = buf;
        if (name === "music") scheduleMusic(ctx.currentTime + 0.1);
        if (name === "waves") audio.waves = startLoop(buf, 0.22);
        if (name === "engine") audio.engine = startLoop(buf, 0);
      })
      .catch(() => {});
  }
}

function startLoop(buf, volume) {
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const gain = audio.ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(audio.sfx);
  src.start();
  return { src, gain };
}

// The music track loops with a 2.5 s crossfade so the seam isn't heard.
function scheduleMusic(when) {
  const ctx = audio.ctx, buf = audio.buffers.music;
  const X = 2.5, dur = buf.duration;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  src.connect(g).connect(audio.music);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + X);
  g.gain.setValueAtTime(1, when + dur - X);
  g.gain.linearRampToValueAtTime(0, when + dur);
  src.start(when);
  src.stop(when + dur + 0.05);
  const next = when + dur - X;
  setTimeout(() => scheduleMusic(next), Math.max(0, (next - ctx.currentTime - 1) * 1000));
}

function beep(freq, dur = 0.12, type = "sine", vol = 0.15, when = 0) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime + when;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audio.sfx);
  osc.start(t);
  osc.stop(t + dur);
}
const FALLBACK = {
  heart: () => { beep(660, 0.1); beep(990, 0.14, "sine", 0.12, 0.07); },
  gold: () => [784, 988, 1175, 1568].forEach((f, i) => beep(f, 0.16, "triangle", 0.12, i * 0.06)),
  bonk: () => beep(140, 0.25, "square", 0.12),
  jump: () => beep(420, 0.12, "triangle", 0.08),
  catch: () => [523, 784, 1047].forEach((f, i) => beep(f, 0.14, "triangle", 0.12, i * 0.08)),
  end: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, "triangle", 0.12, i * 0.12)),
};
function play(name, { volume = 1, rate = 1 } = {}) {
  if (!audio.ctx) return;
  const buf = audio.buffers[name];
  if (!buf) { FALLBACK[name]?.(); return; }
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = audio.ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(audio.sfx);
  src.start();
}

function setMuted(m) {
  audio.muted = m;
  localStorage.setItem("familyIslandMuted", m ? "1" : "0");
  if (audio.master) audio.master.gain.setTargetAtTime(m ? 0 : 1, audio.ctx.currentTime, 0.05);
  ui.muteButtons.forEach((b) => b.classList.toggle("off", m));
}
ui.muteButtons.forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); initAudio(); setMuted(!audio.muted); }));
setMuted(audio.muted);

// ---------- Input ----------
// Keyboard: arrows/WASD run, double-tap a direction (or hold Shift) to sprint,
// Space jumps (casts / reels in the boat), E boards and docks.
const keys = new Set();
const DIR_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const lastTap = {};
let sprintKey = false;
addEventListener("keydown", (e) => {
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (DIR_KEYS.includes(e.code)) {
    const now = performance.now();
    if (now - (lastTap[e.code] || 0) < DOUBLE_TAP_MS) sprintKey = true;
    lastTap[e.code] = now;
  }
  if (state.mode === "playing") {
    if (e.code === "Space") mainAction();
    if (e.code === "KeyE" || e.code === "Enter") altAction();
  } else if ((e.code === "Enter" || e.code === "Space") && (state.mode === "menu" || state.mode === "over")) {
    startGame();
  }
});
addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (!DIR_KEYS.some((k) => keys.has(k))) sprintKey = false;
});

// Touch: drag anywhere for a joystick; double-tap then hold to sprint.
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, sprint: false, lastUp: 0, lastX: 0, lastY: 0 };
canvas.addEventListener("pointerdown", (e) => {
  if (state.mode !== "playing" || stick.id !== null) return;
  const now = performance.now();
  stick.sprint = now - stick.lastUp < DOUBLE_TAP_MS && Math.hypot(e.clientX - stick.lastX, e.clientY - stick.lastY) < 80;
  stick.id = e.pointerId;
  stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0;
  ui.joystick.style.left = `${e.clientX}px`;
  ui.joystick.style.top = `${e.clientY}px`;
  ui.knob.style.transform = "";
  ui.joystick.classList.toggle("sprint", stick.sprint);
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
  stick.id = null; stick.x = stick.y = 0; stick.sprint = false;
  stick.lastUp = performance.now(); stick.lastX = e.clientX; stick.lastY = e.clientY;
  ui.joystick.classList.add("hidden");
}
canvas.addEventListener("pointerup", releaseStick);
canvas.addEventListener("pointercancel", releaseStick);
for (const [btn, fn] of [[ui.btnMain, () => mainAction()], [ui.btnAlt, () => altAction()]]) {
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
}

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
const wantsSprint = () => sprintKey || stick.sprint || keys.has("ShiftLeft") || keys.has("ShiftRight");

// ---------- State ----------
const state = {
  mode: "loading",          // loading | menu | playing | over
  hero: localStorage.getItem("familyIslandHero") === "M" ? "M" : "JM",
  score: 0, hearts: 0, fish: 0, lives: LIVES, time: ROUND_SECONDS, elapsed: 0,
  combo: 0, lastPickup: -10, invuln: 0, stun: 0, nextCoconut: 3, shake: 0,
  stamina: 100, exhausted: false, sprinting: false,
  inBoat: false,
};
const world = {
  env: null, characters: {}, player: null, playerChar: null, npcs: [],
  velocity: new THREE.Vector3(), yaw: 0, turnRate: 0,
  jumpY: 0, vy: 0, air: 0, land: 0,
  boatSpeed: 0, boatHeading: 0, boatTurn: 0,
  fishing: null, spots: [], leaps: [],
  circles: [], npcCircles: [], boxes: [],
  hearts: [], coconuts: [], occluders: [], particles: [],
};
const goldMaterial = new THREE.MeshStandardMaterial({
  color: 0xffc83d, emissive: 0x8a5a00, emissiveIntensity: 0.5, roughness: 0.25, metalness: 0.45,
});
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xe8612c, transparent: true, opacity: 0.7, depthWrite: false });
const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
const rippleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
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
  buildFishingGear();
  placeFamily(state.hero);
}

function placeFamily(hero) {
  const { spots } = world.env;
  const other = hero === "JM" ? "M" : "JM";
  const faceCam = Math.atan2(CAM_DIR.x, CAM_DIR.z);
  const place = (c, p, yaw) => {
    scene.add(c.root);
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
  ui.lede.innerHTML = `Help <b>${name}</b> collect hearts for <b>${others}</b>, then take the boat out fishing. Dodge the coconuts!`;
  if (state.mode === "menu") placeFamily(name);
}
ui.heroButtons.forEach((b) => b.addEventListener("click", () => selectHero(b.dataset.hero)));

// Small offscreen renders: hero portraits for the menu, fish pictures for the catch card.
function snapshot(object, cam, w, h) {
  const pr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  pr.setPixelRatio(2);
  pr.setSize(w, h);
  pr.toneMapping = THREE.NeutralToneMapping;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0xcdbfae, 1.7));
  const key = new THREE.DirectionalLight(0xfff1de, 2.0);
  key.position.set(-1, 2, 3);
  s.add(key, object);
  pr.render(s, cam);
  const url = pr.domElement.toDataURL("image/png");
  pr.dispose();
  return url;
}
function renderPortraits() {
  for (const name of ["JM", "M"]) {
    const c = makeCharacter(FAMILY[name]);
    c.update(0.016, "idle");
    const cam = new THREE.PerspectiveCamera(24, 220 / 260, 0.1, 20);
    const top = FAMILY[name].height;
    cam.position.set(0.35, top * 0.82, 1.9);
    cam.lookAt(0, top * 0.62, 0);
    const img = $(`portrait-${name}`);
    if (img) img.src = snapshot(c.root, cam, 220, 260);
  }
  for (const f of FISH) {
    const fish = makeFish(f);
    fish.rotation.y = -0.35;
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    cam.position.set(0, 0.15, 1.1);
    cam.lookAt(0, 0, 0);
    f.image = snapshot(fish, cam, 160, 160);
  }
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

// ---------- Particles (dust, splashes, wake) ----------
const puffTexture = (() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
function puff(pos, { vel = new THREE.Vector3(), life = 0.6, size = 0.25, grow = 1.5, color = 0xffffff, opacity = 0.7, gravity = 0 } = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture, color, transparent: true, opacity, depthWrite: false }));
  s.position.copy(pos);
  s.scale.setScalar(size);
  scene.add(s);
  world.particles.push({ s, vel, life, age: 0, size, grow, opacity, gravity });
}
function updateParticles(dt) {
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.age += dt;
    const k = p.age / p.life;
    if (k >= 1) { scene.remove(p.s); p.s.material.dispose(); world.particles.splice(i, 1); continue; }
    p.vel.y -= p.gravity * dt;
    p.s.position.addScaledVector(p.vel, dt);
    p.s.scale.setScalar(p.size * (1 + p.grow * k));
    p.s.material.opacity = p.opacity * (1 - k);
  }
}
function splash(pos, n = 10, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    puff(pos.clone().setY(pos.y + 0.03), {
      vel: new THREE.Vector3(Math.cos(a) * 0.9, 1.6 + Math.random() * 1.2, Math.sin(a) * 0.9),
      life: 0.6, size, grow: 0.5, opacity: 0.9, gravity: 6,
    });
  }
}

// ---------- Hearts ----------
function spawnHeart() {
  for (let tries = 0; tries < 60; tries++) {
    const x = (Math.random() * 2 - 1) * 7.5, z = (Math.random() * 2 - 1) * 7.5;
    if (!isFree(x, z, 0.4)) continue;
    if (Math.hypot(x - world.player.position.x, z - world.player.position.z) < 1.6) continue;
    const gold = Math.random() < GOLD_CHANCE;
    const sky = !gold && Math.random() < SKY_CHANCE; // floats high: jump to grab it
    const mesh = makeHeart(gold ? 0.36 : 0.3, gold ? goldMaterial : world.env.heartMat);
    const gy = groundHeight(x, z);
    const base = gy + (sky ? 1.12 : 0.42);
    mesh.position.set(x, base, z);
    mesh.scale.setScalar(0.01);
    scene.add(mesh);
    let shadow = null;
    if (sky) {
      shadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), shadowMaterial);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(x, gy + 0.015, z);
      scene.add(shadow);
    }
    world.hearts.push({ mesh, shadow, gold, sky, age: 0, base, phase: Math.random() * 6 });
    return;
  }
}

const chest = new THREE.Vector3();
function updateHearts(dt) {
  const p = world.player.position;
  chest.set(p.x, p.y + 0.5, p.z);
  for (let i = world.hearts.length - 1; i >= 0; i--) {
    const h = world.hearts[i];
    h.age += dt;
    h.mesh.scale.setScalar(Math.min(1, h.age * 4));
    h.mesh.rotation.y += dt * 2;
    h.mesh.position.y = h.base + Math.sin(h.age * 3 + h.phase) * 0.06;
    if (state.mode === "playing" && !state.inBoat && h.mesh.position.distanceTo(chest) < 0.46) {
      collectHeart(h);
      scene.remove(h.mesh);
      if (h.shadow) scene.remove(h.shadow);
      world.hearts.splice(i, 1);
    }
  }
  while (state.mode === "playing" && world.hearts.length < MAX_HEARTS) spawnHeart();
}

function collectHeart(h) {
  state.combo = state.elapsed - state.lastPickup < COMBO_WINDOW ? Math.min(state.combo + 1, 5) : 1;
  state.lastPickup = state.elapsed;
  const points = (h.gold ? 5 : h.sky ? 2 : 1) * state.combo;
  state.score += points;
  state.hearts += 1;
  if (h.gold) { state.time += 3; play("gold"); } else play("heart", { rate: 1 + (state.combo - 1) * 0.06 });
  popup(h.mesh.position, `+${points}${state.combo > 1 ? `  ×${state.combo}` : ""}${h.gold ? "  +3s" : ""}`, h.gold ? "gold" : "");
}

// ---------- Coconuts: fall on the orange rings, then roll ----------
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
    if (isFree(x, z, 0.02) && !inPier(x, z, 0.3)) break;
  }
  const gy = groundHeight(x, z);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.38, 28), ringMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, gy + 0.02, z);
  const nut = new THREE.Mesh(coconutGeo, coconutMat);
  nut.castShadow = true;
  nut.position.set(x, gy + COCONUT_DROP_HEIGHT, z);
  scene.add(ring, nut);
  world.coconuts.push({ ring, nut, gy, t: 0, landed: false, vx: 0, vz: 0, hopped: false });
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
        play("thud", { volume: 0.7 });
        if (canBeHit() && world.jumpY < 0.3 &&
            Math.hypot(p.x - c.nut.position.x, p.z - c.nut.position.z) < 0.42) hitPlayer();
        const a = Math.random() * Math.PI * 2;
        c.vx = Math.cos(a) * 1.5; c.vz = Math.sin(a) * 1.5;
      }
    } else {
      // Roll for a bit; jump over a rolling coconut for a bonus, get run over and it hurts.
      const nx = c.nut.position.x + c.vx * dt, nz = c.nut.position.z + c.vz * dt;
      if (walkable(nx, nz)) { c.nut.position.x = nx; c.nut.position.z = nz; } else { c.vx *= -0.5; c.vz *= -0.5; }
      c.nut.position.y = groundHeight(c.nut.position.x, c.nut.position.z) + 0.1;
      c.nut.rotation.z -= Math.hypot(c.vx, c.vz) * dt / 0.11;
      c.vx *= 0.985; c.vz *= 0.985;
      const d = Math.hypot(p.x - c.nut.position.x, p.z - c.nut.position.z);
      if (c.t < 1.8 && d < 0.3) {
        if (world.jumpY > 0.15 && !c.hopped && state.mode === "playing") {
          c.hopped = true;
          state.score += 1;
          popup(c.nut.position, "Hop! +1", "");
        } else if (world.jumpY < 0.12 && canBeHit()) hitPlayer();
      }
      if (c.t > 2.2) c.nut.position.y -= (c.t - 2.2) * 0.8;
      if (c.t > 2.6) { scene.remove(c.nut); world.coconuts.splice(i, 1); }
    }
  }
}
const canBeHit = () => state.mode === "playing" && !state.inBoat && state.invuln <= 0;

function hitPlayer() {
  state.lives -= 1;
  state.invuln = 1.6;
  state.stun = 0.45;
  state.shake = 0.3;
  state.combo = 0;
  world.velocity.multiplyScalar(0.2);
  play("bonk");
  popup(world.player.position, "Bonk!", "bad");
  renderLives();
  if (state.lives <= 0) endGame("Bonk! Out of lives");
}

// ---------- Player on foot ----------
const desired = new THREE.Vector3();
function updatePlayer(dt) {
  const hero = world.player;
  const c = world.playerChar;
  if (state.inBoat) {
    c.update(dt, world.fishing ? "fish" : "sit");
    hero.visible = true;
    return;
  }
  const canMove = state.mode === "playing" && state.stun <= 0;
  const dir = canMove ? inputDirection() : new THREE.Vector3();
  const moving = dir.lengthSq() > 0.01;

  // Sprint: costs stamina; once empty you have to recover a little before sprinting again.
  state.sprinting = moving && wantsSprint() && !state.exhausted && state.stamina > 0;
  if (state.sprinting) {
    state.stamina = Math.max(0, state.stamina - STAMINA_DRAIN * dt);
    if (state.stamina === 0) state.exhausted = true;
  } else {
    state.stamina = Math.min(100, state.stamina + STAMINA_REGEN * dt);
    if (state.stamina > 30) state.exhausted = false;
  }
  desired.copy(dir).multiplyScalar(state.sprinting ? SPRINT_SPEED : RUN_SPEED);
  world.velocity.lerp(desired, 1 - Math.exp(-dt * (world.jumpY > 0 ? ACCEL * 0.35 : ACCEL)));
  const speed = world.velocity.length();

  if (speed > 0.01) {
    const next = hero.position.clone().addScaledVector(world.velocity, dt);
    collide(next, PLAYER_RADIUS);
    if (walkable(next.x, next.z)) hero.position.copy(next);
    else if (walkable(next.x, hero.position.z)) hero.position.x = next.x;
    else if (walkable(hero.position.x, next.z)) hero.position.z = next.z;
  }

  // Jump physics.
  if (world.jumpY > 0 || world.vy > 0) {
    world.vy -= GRAVITY * dt;
    world.jumpY += world.vy * dt;
    if (world.jumpY <= 0) {
      world.jumpY = 0;
      world.vy = 0;
      world.land = 1;
      play("land", { volume: 0.6 });
      puffRing(hero.position, 5);
    }
  }
  world.land = Math.max(0, world.land - dt * 5);
  world.air += ((world.jumpY > 0.02 ? 1 : 0) - world.air) * Math.min(1, dt * 14);
  hero.position.y = groundHeight(hero.position.x, hero.position.z) + world.jumpY;

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
  c.update(dt, "run", speed / RUN_SPEED, world.turnRate, { air: world.air, land: world.land });

  // Kick up dust when sprinting.
  if (state.sprinting && world.jumpY === 0 && speed > 3 && Math.random() < dt * 18) {
    puff(hero.position.clone().setY(hero.position.y + 0.04), {
      vel: world.velocity.clone().multiplyScalar(-0.15).setY(0.25), life: 0.5, size: 0.14, grow: 2, color: 0xf3e7d3, opacity: 0.6,
    });
  }
  hero.visible = state.invuln > 0 ? Math.floor(state.invuln * 12) % 2 === 0 : true;
}

function puffRing(pos, n) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    puff(pos.clone().setY(pos.y + 0.03), { vel: new THREE.Vector3(Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6), life: 0.4, size: 0.1, grow: 1.5, color: 0xf3e7d3, opacity: 0.5 });
  }
}

function jump() {
  if (state.inBoat || state.stun > 0 || world.jumpY > 0 || world.vy > 0) return;
  world.vy = JUMP_SPEED;
  world.jumpY = 0.001;
  play("jump", { volume: 0.7 });
}

function updateNpcs(dt) {
  const p = world.player.position;
  world.npcs.forEach((c, i) => {
    const near = Math.hypot(c.root.position.x - p.x, c.root.position.z - p.z) < 2.6;
    const mode = i > 0 || near || state.mode !== "playing" ? "wave" : "idle";
    c.update(dt, mode);
  });
}

// ---------- The boat ----------
const SEAT = new THREE.Vector3(-0.6, 0.3, 0);
const boatDist = () => {
  const b = world.env.boat.position, p = world.player.position;
  return Math.hypot(b.x - p.x, b.z - p.z);
};
const canBoard = () => !state.inBoat && world.jumpY === 0 && boatDist() < 1.25;
const canDock = () => state.inBoat && !world.fishing &&
  world.env.boat.position.distanceTo(world.env.dock.mooring) < 1.7 && Math.abs(world.boatSpeed) < 1.6;

function board() {
  const { boat, boatBob } = world.env;
  state.inBoat = true;
  world.velocity.set(0, 0, 0);
  world.boatSpeed = 0;
  world.boatHeading = -boat.rotation.y;
  const hero = world.player;
  boatBob.add(hero);
  hero.position.set(SEAT.x, SEAT.y - world.playerChar.hipHeight, SEAT.z);
  hero.rotation.set(0, Math.PI / 2, 0); // face the bow (+x)
  play("board");
  popup(boat.position, "All aboard!", "");
}

function dock() {
  const { boat, dock: d } = world.env;
  state.inBoat = false;
  world.boatSpeed = 0;
  boat.position.copy(d.mooring);
  boat.rotation.y = -d.heading;
  world.boatHeading = d.heading;
  boat.userData.lean = 0;
  const hero = world.player;
  scene.add(hero);
  hero.position.copy(d.step);
  world.yaw = Math.atan2(-Math.cos(d.heading), -Math.sin(d.heading)); // face back up the pier
  hero.rotation.set(0, world.yaw, 0);
  world.jumpY = 0; world.vy = 0;
  play("board");
}

function boatBlocked(x, z) {
  const r = Math.hypot(x, z);
  return r < shoreRadius(Math.atan2(z, x)) + 0.85 || r > BOAT_MAX_R || inPier(x, z, 0.55);
}

function updateBoat(dt) {
  const { boat } = world.env;
  let throttle = 0;
  if (state.inBoat && state.mode === "playing" && !world.fishing) {
    const dir = inputDirection();
    const mag = Math.min(1, dir.length());
    if (mag > 0.1) {
      // Turn the bow towards the stick, throttle by how far it's pushed.
      const target = Math.atan2(dir.z, dir.x);
      const diff = Math.atan2(Math.sin(target - world.boatHeading), Math.cos(target - world.boatHeading));
      const rate = 2.2 * Math.min(1, 0.35 + Math.abs(world.boatSpeed) / BOAT_SPEED);
      const step = THREE.MathUtils.clamp(diff, -rate * dt, rate * dt);
      world.boatHeading += step;
      world.boatTurn = step / dt;
      throttle = mag * (Math.abs(diff) > 2.2 ? 0.3 : 1);
    } else world.boatTurn *= 0.9;
  }
  const max = wantsSprint() ? BOAT_BOOST : BOAT_SPEED;
  world.boatSpeed += (throttle * max - world.boatSpeed) * (1 - Math.exp(-dt * (throttle ? 1.6 : 0.9)));
  if (Math.abs(world.boatSpeed) > 0.01) {
    const nx = boat.position.x + Math.cos(world.boatHeading) * world.boatSpeed * dt;
    const nz = boat.position.z + Math.sin(world.boatHeading) * world.boatSpeed * dt;
    if (boatBlocked(nx, nz)) world.boatSpeed *= -0.3;
    else { boat.position.x = nx; boat.position.z = nz; }
  }
  if (state.inBoat) boat.rotation.y = -world.boatHeading;
  boat.userData.lean = THREE.MathUtils.clamp(world.boatTurn * 0.06, -0.12, 0.12) * Math.min(1, world.boatSpeed / BOAT_SPEED);

  // White wake behind the stern.
  const sp = Math.abs(world.boatSpeed);
  if (sp > 0.5 && Math.random() < dt * 30) {
    const back = new THREE.Vector3(-Math.cos(world.boatHeading), 0, -Math.sin(world.boatHeading));
    const side = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar((Math.random() - 0.5) * 0.5);
    puff(boat.position.clone().addScaledVector(back, 1.05).add(side).setY(-0.02), {
      vel: back.clone().multiplyScalar(0.4).add(side), life: 1.4, size: 0.22, grow: 2.2, opacity: 0.75,
    });
  }
  if (audio.engine) {
    const v = state.inBoat ? 0.18 + 0.5 * sp / BOAT_BOOST : 0;
    audio.engine.gain.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.1);
    audio.engine.src.playbackRate.setTargetAtTime(0.85 + 0.45 * sp / BOAT_BOOST, audio.ctx.currentTime, 0.1);
  }
}

// ---------- Fishing ----------
function makeFish(type) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: type.body, roughness: 0.5, flatShading: true });
  const finMat = new THREE.MeshStandardMaterial({ color: type.fin, roughness: 0.6, flatShading: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), bodyMat);
  body.scale.set(1.6, 0.95, 0.55);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 4), finMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.23;
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 3), finMat);
  fin.position.set(0.02, 0.12, 0);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  eye.position.set(0.13, 0.03, 0.055);
  g.add(body, tail, fin, eye);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

let rod, line, bobber;
function buildFishingGear() {
  rod = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x3b2a1e }));
  stick.position.y = 0.4;
  rod.add(stick);
  rod.position.set(-0.32, 0.55, 0.08);
  rod.rotation.set(0, 0, -1.0);   // leaning out over the bow
  rod.visible = false;
  world.env.boatBob.add(rod);
  bobber = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8612c }));
  bobber.visible = false;
  scene.add(bobber);
  line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.85 }));
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
}

function spawnSpot() {
  for (let tries = 0; tries < 60; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = shoreRadius(a) + 2.2 + Math.random() * (BOAT_MAX_R - shoreRadius(a) - 3.4);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (inPier(x, z, 2) || world.spots.some((s) => s.pos.distanceTo(new THREE.Vector3(x, 0, z)) < 3)) continue;
    const group = new THREE.Group();
    group.position.set(x, -0.03, z);
    const rings = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 32), rippleMaterial.clone());
      m.rotation.x = -Math.PI / 2;
      m.userData.offset = i / 3;
      group.add(m);
      return m;
    });
    scene.add(group);
    world.spots.push({ pos: new THREE.Vector3(x, 0, z), group, rings, fish: 1 + Math.floor(Math.random() * 3), nextLeap: 1 + Math.random() * 3 });
    return;
  }
}

function removeSpot(spot) {
  scene.remove(spot.group);
  world.spots.splice(world.spots.indexOf(spot), 1);
  setTimeout(() => { if (state.mode === "playing") spawnSpot(); }, 2000);
}

function nearSpot() {
  if (!state.inBoat) return null;
  const b = world.env.boat.position;
  return world.spots.find((s) => Math.hypot(s.pos.x - b.x, s.pos.z - b.z) < 1.5) || null;
}
const canFish = () => state.inBoat && !world.fishing && Math.abs(world.boatSpeed) < 1.2 && nearSpot();

function updateSpots(dt, t) {
  for (const s of world.spots) {
    for (const r of s.rings) {
      const k = (t * 0.45 + r.userData.offset) % 1;
      r.scale.setScalar(0.5 + k * 2.2);
      r.material.opacity = 0.75 * (1 - k);
    }
    s.nextLeap -= dt;
    if (s.nextLeap <= 0 && !(world.fishing && world.fishing.spot === s)) {
      s.nextLeap = 2 + Math.random() * 4;
      const type = FISH[Math.floor(Math.random() * 2)];
      const fish = makeFish(type);
      const a = Math.random() * Math.PI * 2;
      fish.rotation.y = -a;
      scene.add(fish);
      world.leaps.push({ fish, t: 0, from: s.pos.clone(), dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) });
      splash(s.pos, 6, 0.08);
    }
  }
  // Fish leaping out of the water in little arcs.
  for (let i = world.leaps.length - 1; i >= 0; i--) {
    const L = world.leaps[i];
    L.t += dt;
    const k = L.t / 0.75;
    if (k >= 1) { splash(L.fish.position, 6, 0.08); scene.remove(L.fish); world.leaps.splice(i, 1); continue; }
    L.fish.position.copy(L.from).addScaledVector(L.dir, k * 0.9).setY(Math.sin(k * Math.PI) * 0.55 - 0.05);
    L.fish.rotation.z = (0.5 - k) * 2;
  }
}

function startFishing() {
  const spot = nearSpot();
  if (!spot) return;
  world.boatSpeed = 0;
  world.fishing = { phase: "cast", t: 0, spot, biteAt: 1.2 + Math.random() * 1.8 };
  rod.visible = true;
  popup(world.env.boat.position, "Casting…", "");
}

function reel() {
  const f = world.fishing;
  if (!f) return;
  if (f.phase === "wait" || f.phase === "cast") {
    popup(bobber.position, "Too early!", "bad");
    play("miss");
    f.spot.fish -= 1;
    if (f.spot.fish <= 0) removeSpot(f.spot);
    endFishing();
  } else if (f.phase === "bite") {
    const roll = Math.random();
    let acc = 0;
    const type = FISH.find((x) => (acc += x.weight) >= roll) || FISH[0];
    const fish = makeFish(type);
    scene.add(fish);
    f.phase = "reel";
    f.t = 0;
    f.catch = { fish, type, from: bobber.position.clone() };
    play("catch");
    splash(bobber.position, 14, 0.12);
  }
}

function endFishing() {
  world.fishing = null;
  rod.visible = false;
  line.visible = false;
  bobber.visible = false;
}

const tip = new THREE.Vector3();
function updateFishing(dt, t) {
  const f = world.fishing;
  if (!f) return;
  f.t += dt;
  // Moving the boat away cancels the cast.
  if (inputDirection().lengthSq() > 0.25 && f.phase !== "reel") { endFishing(); return; }
  rod.children[0].localToWorld(tip.set(0, 0.4, 0));
  const spotPos = f.spot.pos;
  if (f.phase === "cast") {
    // The bobber flies out from the rod tip to the spot.
    const k = Math.min(1, f.t / 0.5);
    bobber.visible = true;
    bobber.position.lerpVectors(tip, spotPos, k).setY(THREE.MathUtils.lerp(tip.y, 0, k) + Math.sin(k * Math.PI) * 0.6);
    rod.rotation.z = -1.0 + Math.sin(k * Math.PI) * 0.7;
    if (k >= 1) { f.phase = "wait"; f.t = 0; play("splash", { volume: 0.8 }); splash(spotPos, 6, 0.08); }
  } else if (f.phase === "wait") {
    bobber.position.set(spotPos.x, -0.02 + Math.sin(t * 4) * 0.015, spotPos.z);
    if (f.t > f.biteAt) {
      f.phase = "bite"; f.t = 0;
      play("bite");
      popup(spotPos, "!", "gold");
    }
  } else if (f.phase === "bite") {
    bobber.position.set(spotPos.x, -0.1 + Math.sin(t * 30) * 0.03, spotPos.z);
    if (f.t > 0.9) {
      popup(spotPos, "It got away!", "bad");
      play("miss");
      endFishing();
      return;
    }
  } else if (f.phase === "reel") {
    // The fish arcs up out of the water into the boat.
    const k = Math.min(1, f.t / 0.7);
    const to = world.env.boat.position.clone().setY(0.4);
    f.catch.fish.position.lerpVectors(f.catch.from, to, k).setY(THREE.MathUtils.lerp(0, 0.4, k) + Math.sin(k * Math.PI) * 0.9);
    f.catch.fish.rotation.z += dt * 10;
    bobber.position.copy(f.catch.fish.position);
    if (k >= 1) {
      scene.remove(f.catch.fish);
      const { type } = f.catch;
      state.score += type.points;
      state.fish += 1;
      if (type.bonusTime) state.time += type.bonusTime;
      showCatch(type);
      f.spot.fish -= 1;
      if (f.spot.fish <= 0) removeSpot(f.spot);
      endFishing();
      return;
    }
  }
  line.visible = true;
  line.geometry.setFromPoints([tip, bobber.position]);
}

function showCatch(type) {
  ui.catchImg.src = type.image || "";
  ui.catchText.innerHTML = `<b>${type.name}</b><span>+${type.points}${type.bonusTime ? ` · +${type.bonusTime}s` : ""}</span>`;
  ui.catchCard.classList.remove("show");
  void ui.catchCard.offsetWidth;
  ui.catchCard.classList.add("show");
}

// ---------- Context actions (Space / main button, E / alt button) ----------
function mainAction() {
  if (state.mode !== "playing") return;
  initAudio();
  if (state.inBoat) {
    if (world.fishing) reel();
    else if (canFish()) startFishing();
  } else jump();
}
function altAction() {
  if (state.mode !== "playing") return;
  initAudio();
  if (canBoard()) board();
  else if (canDock()) dock();
}

function updatePrompts() {
  let main = "Jump", alt = "", hint = "";
  if (state.inBoat) {
    const f = world.fishing;
    if (f) { main = f.phase === "bite" ? "Reel!" : "…"; hint = f.phase === "bite" ? "Space — reel it in!" : "Wait for a bite…"; }
    else if (canFish()) { main = "Fish"; hint = "Space — cast your line"; }
    else main = "";
    if (canDock()) { alt = "Dock"; hint = hint || "E — step onto the pier"; }
    if (!hint && !f) hint = world.spots.length ? "Sail to the ripples to fish" : "";
  } else if (canBoard()) { alt = "Board"; hint = "E — get on the boat"; }
  ui.btnMain.textContent = main;
  ui.btnMain.classList.toggle("hidden", !main);
  ui.btnMain.classList.toggle("urgent", main === "Reel!");
  ui.btnAlt.textContent = alt;
  ui.btnAlt.classList.toggle("hidden", !alt);
  ui.prompt.textContent = hint;
  ui.prompt.classList.toggle("hidden", !hint || isTouch);
  const showStamina = !state.inBoat && state.stamina < 99.5;
  ui.stamina.classList.toggle("hidden", !showStamina);
  ui.staminaFill.style.width = `${state.stamina}%`;
  ui.stamina.classList.toggle("tired", state.exhausted);
}

// ---------- Camera ----------
const camTarget = new THREE.Vector3();
const camLook = new THREE.Vector3(0, 0, 1);
let orbit = 0;
function updateCamera(dt) {
  const portrait = innerWidth < innerHeight;
  let vh, look, dir = CAM_DIR;
  if (state.mode === "playing" || state.mode === "over") {
    const focus = state.inBoat ? world.env.boat.position : world.player.position;
    vh = state.inBoat ? (portrait ? 9.5 : 7.2) : (portrait ? 6.2 : 4.8);
    look = new THREE.Vector3(focus.x, 0.3, focus.z);
  } else {
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

const raycaster = new THREE.Raycaster();
const heroWorld = new THREE.Vector3();
function fadeOccluders(dt) {
  const hidden = new Set();
  world.player.getWorldPosition(heroWorld);
  for (const h of [0.15, 0.5, 0.85]) {
    raycaster.set(new THREE.Vector3(heroWorld.x, heroWorld.y + h, heroWorld.z), CAM_DIR);
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
  ui.tally.textContent = `♥ ${state.hearts} · fish ${state.fish}`;
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
  for (const h of world.hearts) { scene.remove(h.mesh); if (h.shadow) scene.remove(h.shadow); }
  for (const c of world.coconuts) scene.remove(c.nut, c.ring);
  for (const s of world.spots) scene.remove(s.group);
  for (const L of world.leaps) scene.remove(L.fish);
  world.hearts.length = 0;
  world.coconuts.length = 0;
  world.spots.length = 0;
  world.leaps.length = 0;
  if (world.fishing) endFishing();
}

function resetBoat() {
  const { boat, dock: d } = world.env;
  boat.position.copy(d.mooring);
  boat.rotation.y = -d.heading;
  world.boatHeading = d.heading;
  world.boatSpeed = 0;
  boat.userData.lean = 0;
}

function startGame(hero = state.hero) {
  initAudio();
  clearField();
  state.inBoat = false;
  resetBoat();
  selectHero(hero);
  placeFamily(hero);
  Object.assign(state, {
    mode: "playing", score: 0, hearts: 0, fish: 0, lives: LIVES, time: ROUND_SECONDS, elapsed: 0,
    combo: 0, lastPickup: -10, invuln: 0, stun: 0, nextCoconut: 3, shake: 0,
    stamina: 100, exhausted: false, sprinting: false,
  });
  world.velocity.set(0, 0, 0);
  world.jumpY = 0; world.vy = 0; world.air = 0;
  for (let i = 0; i < FISH_SPOTS; i++) spawnSpot();
  ui.menu.classList.add("hidden");
  ui.over.classList.add("hidden");
  ui.hud.classList.remove("hidden");
  renderLives();
  renderHud();
}

function endGame(title) {
  if (state.mode !== "playing") return;
  state.mode = "over";
  if (world.fishing) endFishing();
  stick.id = null; stick.x = stick.y = 0;
  ui.joystick.classList.add("hidden");
  const prev = bestScore();
  const best = Math.max(prev, state.score);
  localStorage.setItem("familyIslandBest", best);
  ui.overTitle.textContent = title;
  ui.final.textContent = state.score;
  ui.overTally.textContent = `${state.hearts} hearts · ${state.fish} fish`;
  ui.bestOver.textContent = state.score > prev && state.score > 0 ? "New best score!" : `Best score — ${best}`;
  play("end");
  setTimeout(() => ui.over.classList.remove("hidden"), 600);
}

function backToMenu() {
  clearField();
  if (state.inBoat) { state.inBoat = false; }
  resetBoat();
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

// Test hook: ?debug exposes the game state (used by the automated play tests).
if (params.has("debug")) window.__game = { state, world, startGame, board, dock, jump, mainAction, altAction, canBoard, canFish };

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
      if (!state.inBoat) state.nextCoconut -= dt; // coconuts only fall on land
      if (state.nextCoconut <= 0) {
        spawnCoconut();
        state.nextCoconut = Math.max(0.45, 1.4 - state.elapsed * 0.016) * (0.7 + Math.random() * 0.6);
      }
      if (state.time <= 0) { state.time = 0; endGame("Time's up!"); }
      renderHud();
    }
    state.shake = Math.max(0, state.shake - dt);
    updateBoat(dt);
    updatePlayer(dt);
    updateNpcs(dt);
    updateHearts(dt);
    updateCoconuts(dt);
    updateSpots(dt, elapsedTotal);
    updateFishing(dt, elapsedTotal);
    updateParticles(dt);
    if (state.mode === "playing") updatePrompts();
    if (audio.waves) audio.waves.gain.gain.setTargetAtTime(state.inBoat ? 0.38 : 0.22, audio.ctx.currentTime, 0.3);
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
