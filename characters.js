// Stylised low-poly family, after the character reference: long limbs, long face,
// chunky hair, matte painted fabrics, an open shirt over a printed tee, socks and sneakers.
import * as THREE from "three";

const SKIN = 0x5a3823;          // dark skin
const HAIR = 0x16100c;
const loader = new THREE.TextureLoader();

const fabricCache = new Map();
function fabricTexture(path, repeat) {
  if (!fabricCache.has(path)) {
    const t = loader.load(new URL(path, import.meta.url).href); // relative to this module
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    fabricCache.set(path, t);
  }
  return fabricCache.get(path);
}

const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...extra });

// A chunky pixel-style print, like the knitted skull on the reference tee.
function printTexture(text, bg, fg) {
  const small = document.createElement("canvas");
  small.width = small.height = 32;
  const c = small.getContext("2d");
  c.fillStyle = bg;
  c.fillRect(0, 0, 32, 32);
  c.fillStyle = fg;
  c.font = `bold ${text.length > 1 ? 14 : 18}px ui-monospace, Menlo, monospace`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 16, 15);
  const big = document.createElement("canvas");
  big.width = big.height = 256;
  const g = big.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(big);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function stripeTexture(a, b) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  for (let y = 0; y < 64; y += 16) {
    c.fillStyle = a; c.fillRect(0, y, 64, 8);
    c.fillStyle = b; c.fillRect(0, y + 8, 64, 8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mesh(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

// A cylinder hanging down from its top (so it pivots at the joint).
function limb(rTop, rBottom, len, m, seg = 6) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
  g.translate(0, -len / 2, 0);
  return g;
}

// A box tapered from bottom width to top width, sitting on y=0.
function taperedBox(wBottom, wTop, h, d) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const w = wBottom + (wTop - wBottom) * y;
    p.setXYZ(i, p.getX(i) * w, y * h, p.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * spec: { name, height, hip, headScale, top: "openShirt"|"tee"|"dress", fabric, teeColor,
 *         print: [text, bg, fg], bottom: "shorts"|"skirt", bottomColor, shoes, socks, hair, glasses }
 * Returns { root, update(dt, mode) } — mode: "idle" | "walk" | "wave".
 */
export function makeCharacter(spec) {
  const root = new THREE.Group();
  root.name = spec.name;
  const body = new THREE.Group();
  body.scale.setScalar(spec.height);
  root.add(body);

  const skin = mat(SKIN);
  const hair = mat(HAIR);
  const dark = mat(0x111111);
  const white = mat(0xf4f1ea);
  const shoe = mat(spec.shoes ?? 0x5b3a2a);
  const fabricMat = spec.fabric ? mat(0xffffff, { map: fabricTexture(spec.fabric, 0.9) }) : null;
  const teeMat = spec.teeStripes ? mat(0xffffff, { map: stripeTexture(...spec.teeStripes) }) : mat(spec.teeColor ?? 0x222222);
  const printMat = mat(0xffffff, { map: printTexture(...spec.print) });
  const bottomMat = spec.bottom === "skirt" && spec.top === "dress" ? fabricMat : mat(spec.bottomColor ?? 0x3e4a42);

  const hipY = spec.hip ?? 0.476;
  const legLen = hipY - 0.046;
  const shoulderW = spec.shoulder ?? 0.2;

  // Legs: hip -> knee -> ankle joints.
  const legs = [];
  const thighLen = legLen * 0.5, shinLen = legLen * 0.5;
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.045, hipY, 0);
    hip.add(mesh(limb(0.031, 0.026, thighLen + 0.01, skin), skin));
    if (spec.bottom === "shorts") hip.add(mesh(limb(0.052, 0.05, thighLen * 0.9, bottomMat, 7), bottomMat));
    const knee = new THREE.Group();
    knee.position.y = -thighLen;
    hip.add(knee);
    knee.add(mesh(limb(0.026, 0.021, shinLen, skin), skin));
    if (spec.socks !== false) knee.add(mesh(limb(0.025, 0.025, 0.05, white), white, 0, -shinLen + 0.06, 0));
    const ankle = new THREE.Group();
    ankle.position.y = -shinLen;
    knee.add(ankle);
    ankle.add(mesh(new THREE.BoxGeometry(0.062, 0.038, 0.12), shoe, 0, -0.012, 0.02));
    ankle.add(mesh(new THREE.BoxGeometry(0.066, 0.012, 0.126), white, 0, -0.034, 0.02));
    body.add(hip);
    legs.push({ hip, knee, ankle });
  }

  // Torso: tee (print on the front face only), plus the outer layer.
  const torso = new THREE.Group();
  torso.position.y = hipY;
  body.add(torso);
  const torsoH = 0.29;
  const front = spec.top === "dress" ? fabricMat : printMat;
  const teeSide = spec.top === "dress" ? fabricMat : teeMat;
  // BoxGeometry face order: +x, -x, +y, -y, +z (front), -z
  torso.add(mesh(taperedBox(0.16, shoulderW, torsoH, 0.1), [teeSide, teeSide, teeSide, teeSide, front, teeSide]));
  if (spec.top === "dress") {
    // Small white patch with the initial on the chest.
    const patch = mesh(new THREE.PlaneGeometry(0.075, 0.075), printMat, 0, 0.19, 0.0505);
    patch.castShadow = false;
    torso.add(patch);
  }
  if (spec.bottom === "shorts") torso.add(mesh(new THREE.BoxGeometry(0.17, 0.05, 0.11), bottomMat, 0, 0.0, 0));
  if (spec.bottom === "skirt") {
    const skirtLen = spec.skirtLen ?? 0.22;
    const skirt = new THREE.CylinderGeometry(0.085, 0.15, skirtLen, 8);
    torso.add(mesh(skirt, bottomMat, 0, 0.02 - skirtLen / 2, 0));
  }
  if (spec.top === "openShirt") {
    const h = 0.3, y = 0.13;
    torso.add(mesh(new THREE.BoxGeometry(0.212, h, 0.012), fabricMat, 0, y, -0.057));
    for (const side of [-1, 1]) {
      torso.add(mesh(new THREE.BoxGeometry(0.012, h, 0.114), fabricMat, side * 0.106, y, 0));
      torso.add(mesh(new THREE.BoxGeometry(0.036, h, 0.012), fabricMat, side * 0.089, y, 0.057));
      const lapel = mesh(new THREE.BoxGeometry(0.035, 0.07, 0.01), fabricMat, side * 0.04, 0.25, 0.064);
      lapel.rotation.z = side * 0.45;
      torso.add(lapel);
    }
  }

  // Arms: shoulder -> elbow joints (sleeves ride on the upper arm).
  const arms = [];
  const upperLen = 0.14, foreLen = 0.15;
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (shoulderW / 2 + 0.022), torsoH - 0.03, 0); // torso space
    shoulder.add(mesh(limb(0.021, 0.019, upperLen + 0.01, skin), skin));
    const sleeveMat = spec.top === "openShirt" ? fabricMat : spec.top === "tee" ? teeMat : null;
    if (sleeveMat) shoulder.add(mesh(limb(0.036, 0.038, 0.1, sleeveMat, 7), sleeveMat));
    const elbow = new THREE.Group();
    elbow.position.y = -upperLen;
    shoulder.add(elbow);
    elbow.add(mesh(limb(0.019, 0.016, foreLen, skin), skin));
    elbow.add(mesh(new THREE.BoxGeometry(0.03, 0.055, 0.024), skin, 0, -foreLen - 0.025, 0));
    shoulder.rotation.z = side * 0.07;
    torso.add(shoulder); // arms follow the torso's lean and twist
    arms.push({ shoulder, elbow });
  }

  // Head: long face, defined nose, chunky hair.
  const head = new THREE.Group();
  head.position.y = torsoH;
  head.scale.setScalar(spec.headScale ?? 1);
  torso.add(head);
  head.add(mesh(limb(0.026, 0.026, 0.05, skin), skin, 0, 0.05, 0));
  head.add(mesh(new THREE.CylinderGeometry(0.058, 0.045, 0.165, 7), skin, 0, 0.12, 0));
  const nose = mesh(new THREE.BoxGeometry(0.022, 0.048, 0.03), skin, 0, 0.115, 0.055);
  nose.rotation.x = -0.15;
  head.add(nose);
  for (const side of [-1, 1]) {
    head.add(mesh(new THREE.BoxGeometry(0.016, 0.036, 0.026), skin, side * 0.058, 0.125, 0));
    head.add(mesh(new THREE.BoxGeometry(0.024, 0.014, 0.004), white, side * 0.023, 0.14, 0.054));
    head.add(mesh(new THREE.BoxGeometry(0.011, 0.012, 0.006), dark, side * 0.023, 0.14, 0.056));
    head.add(mesh(new THREE.BoxGeometry(0.028, 0.006, 0.008), hair, side * 0.024, 0.158, 0.054));
  }
  head.add(mesh(new THREE.BoxGeometry(0.024, 0.004, 0.004), dark, 0, 0.078, 0.05));
  if (spec.glasses) {
    const lens = mat(0x7cc4e4, { emissive: 0x1d4f66, emissiveIntensity: 0.4 });
    for (const side of [-1, 1]) {
      head.add(mesh(new THREE.BoxGeometry(0.04, 0.032, 0.006), dark, side * 0.024, 0.14, 0.06));
      head.add(mesh(new THREE.BoxGeometry(0.031, 0.022, 0.007), lens, side * 0.024, 0.14, 0.061));
      head.add(mesh(new THREE.BoxGeometry(0.004, 0.006, 0.06), dark, side * 0.059, 0.145, 0.03));
    }
    head.add(mesh(new THREE.BoxGeometry(0.012, 0.005, 0.006), dark, 0, 0.145, 0.06));
  }
  addHair(head, hair, spec.hair);

  // ---- Animation ----
  // Joint angles: rotation.x > 0 swings a hanging limb backwards (the character faces +z).
  let t = Math.random() * 10;
  let phase = 0;        // stride phase, radians
  let gait = 0;         // 0 = standing, 1 = full run (smoothed)
  let waving = 0;
  const waveSide = spec.waveSide ?? 1;
  const lerp = (a, b, k) => a + (b - a) * k;

  /** mode: "idle" | "run" | "wave"; speed: 0..1 of full running speed; turn: yaw rate (rad/s). */
  function update(dt, mode, speed = 1, turn = 0) {
    t += dt;
    const running = mode === "run" && speed > 0.05;
    gait = lerp(gait, running ? speed : 0, Math.min(1, dt * 8));
    waving = lerp(waving, mode === "wave" ? 1 : 0, Math.min(1, dt * 6));
    // Cadence ~1.4 strides/s at full speed (2.8 steps/s), slower when jogging.
    phase += dt * Math.PI * 2 * (0.9 + 0.5 * gait) * (gait > 0.02 ? 1 : 0);
    const g = gait;

    for (const [i, side] of [-1, 1].entries()) {
      const ph = phase + (i ? Math.PI : 0);
      const L = legs[i];
      // Thigh drives forward up to ~45 deg, extends back ~20 deg.
      L.hip.rotation.x = -(0.18 + 0.62 * Math.sin(ph)) * g;
      // Knee: big heel kick through the swing, extends before landing, soft at mid-stance.
      const kick = Math.max(0, Math.cos(ph + 0.25)) ** 1.5;
      L.knee.rotation.x = (0.3 + 1.35 * kick) * g;
      // Ankle: toes lift on the swing, push off behind.
      L.ankle.rotation.x = (-0.25 * Math.sin(ph) - 0.1) * g;

      // Arms pump opposite the legs with bent elbows.
      const A = arms[i];
      // Upper arm swings ~25 deg forward to ~45 deg back; the elbow bends more on the forward swing.
      const armSwing = Math.sin(ph + Math.PI);
      let sx = (0.2 + 0.6 * armSwing) * g, sz = side * (0.07 + 0.08 * g);
      let ex = -(0.15 + (1.15 - 0.25 * armSwing) * g);
      if (side === waveSide && waving > 0.01) {
        sx = lerp(sx, 0, waving);
        sz = lerp(sz, side * (2.6 + 0.25 * Math.sin(t * 8)), waving);
        ex = lerp(ex, -0.35 + 0.25 * Math.sin(t * 8 + 0.6), waving);
      }
      A.shoulder.rotation.x = sx;
      A.shoulder.rotation.z = sz;
      A.elbow.rotation.x = ex;
    }

    // Body: two bounces per stride (lowest at mid-stance), forward lean, hip/shoulder counter-twist.
    const bounce = Math.abs(Math.sin(phase));
    body.position.y = (bounce * 0.035 - 0.022) * g + Math.sin(t * 2) * 0.003 * (1 - g);
    torso.rotation.x = 0.2 * g;                         // lean into the run
    torso.rotation.y = 0.16 * Math.sin(phase) * g;      // shoulders counter the hips
    for (const L of legs) L.hip.rotation.y = -0.1 * Math.sin(phase) * g;
    body.rotation.z = THREE.MathUtils.clamp(-turn * 0.04, -0.2, 0.2) * g; // bank into turns
    head.rotation.x = -0.14 * g;                        // keep the eyes level
    head.rotation.y = -torso.rotation.y * 0.7;
    head.rotation.z = Math.sin(t * 0.9) * 0.03 * (1 - g);
  }

  root.traverse((o) => { if (o.isMesh) o.userData.character = spec.name; });
  return { root, update, spec };
}

function addHair(head, hair, style) {
  const top = 0.205;
  const cap = mesh(new THREE.IcosahedronGeometry(0.068, 1), hair, 0, top - 0.008, -0.006);
  cap.scale.set(1, 0.6, 1.04);
  head.add(cap);
  head.add(mesh(new THREE.BoxGeometry(0.124, 0.07, 0.03), hair, 0, top - 0.035, -0.052));
  const tuft = (x, z, rx, rz, s = 1) => {
    const c = mesh(new THREE.ConeGeometry(0.032 * s, 0.07 * s, 4), hair, x, top + 0.035, z);
    c.rotation.set(rx, 0, rz);
    head.add(c);
  };
  if (style === "tuft") {
    // Swept-up chunky quiff, like the reference.
    tuft(-0.025, 0.03, 0.5, 0.2, 1.2);
    tuft(0.015, 0.035, 0.6, -0.1, 1.35);
    tuft(0.04, 0.0, 0.3, -0.4);
    tuft(-0.04, -0.02, 0.1, 0.4);
  } else if (style === "bun") {
    head.add(mesh(new THREE.IcosahedronGeometry(0.06, 0), hair, 0, top + 0.05, -0.035));
    for (const side of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.02, 0.08, 0.1), hair, side * 0.06, top - 0.04, -0.01));
  } else if (style === "puffs") {
    for (const side of [-1, 1]) head.add(mesh(new THREE.IcosahedronGeometry(0.048, 0), hair, side * 0.068, top + 0.01, -0.01));
  } else {
    tuft(0, 0.02, 0.3, 0, 0.9);
    tuft(-0.035, 0, 0.1, 0.3, 0.8);
    tuft(0.035, 0, 0.1, -0.3, 0.8);
  }
}

// The family. Heights are in the scene's toy scale (the front door is ~0.92 tall).
export const FAMILY = {
  JM: {
    name: "JM", height: 0.98, top: "openShirt", fabric: "./assets/textures/fabric_jm.jpg",
    teeColor: 0x1c1c1c, print: ["JM", "#1c1c1c", "#f2f2f2"], bottom: "shorts", bottomColor: 0x3f4b43,
    shoes: 0x5b3a2a, hair: "tuft", glasses: true, waveSide: -1,
  },
  M: {
    name: "M", height: 0.92, shoulder: 0.18, top: "dress", fabric: "./assets/textures/fabric_m.jpg",
    print: ["M", "#f6f0e4", "#c8102e"], bottom: "skirt", skirtLen: 0.26, socks: false,
    shoes: 0xc9a27a, hair: "bun", waveSide: 1,
  },
  N: {
    name: "N", height: 0.6, hip: 0.43, headScale: 1.3, shoulder: 0.18, top: "tee", teeColor: 0xf2c94c,
    print: ["N", "#f2c94c", "#7a1f5c"], bottom: "skirt", bottomColor: 0xe98bb4, skirtLen: 0.18,
    shoes: 0xd9667f, hair: "puffs", waveSide: -1,
  },
  H: {
    name: "H", height: 0.56, hip: 0.43, headScale: 1.3, shoulder: 0.18, top: "tee",
    teeStripes: ["#2f4a7a", "#f2efe6"], print: ["H", "#f2efe6", "#2f4a7a"], bottom: "shorts",
    bottomColor: 0xc4462e, shoes: 0x2f4a7a, hair: "short", waveSide: 1,
  },
};

// Start loading the fabrics now, so they're ready (and counted by the loading manager) up front.
for (const spec of Object.values(FAMILY)) if (spec.fabric) fabricTexture(spec.fabric, 0.9);
