// The island, restyled after the architectural axonometric reference: brick walls,
// white corrugated roof, salmon paving, orange track paths, soft lawn, fluffy trees,
// plus a beach, animated water, a wooden pier and a boat.
import * as THREE from "three";

const tex = new THREE.TextureLoader();
function texture(name, tileSize) {
  const t = tex.load(new URL(`./assets/textures/${name}.jpg`, import.meta.url).href);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.userData.tile = tileSize;
  return t;
}

export const COLORS = {
  orange: 0xe8612c, wood: 0xb8693a, white: 0xf7f6f2, roof: 0xf3f4f6,
  palmLeaf: 0x7fb257, palmLeafDark: 0x5f9443, trunk: 0x9b7e62,
};

// ---------- Shoreline ----------
const SHORE_R = 6.9;
export const shoreRadius = (a) => SHORE_R + 0.25 * Math.sin(3 * a + 1) + 0.15 * Math.sin(5 * a + 2);
export const grassRadius = (a) => shoreRadius(a) - 1.0;
const WATER_Y = -0.05;

// ---------- Pier ----------
const PIER_ANGLE = 0.54;
const PIER_DIR = new THREE.Vector2(Math.cos(PIER_ANGLE), Math.sin(PIER_ANGLE));
const PIER_SIDE = new THREE.Vector2(-PIER_DIR.y, PIER_DIR.x);
const PIER_START = 5.5, PIER_END = shoreRadius(PIER_ANGLE) + 2.6, PIER_HALF_W = 0.36, PIER_Y = 0.12;

export function inPier(x, z, margin = 0) {
  const along = x * PIER_DIR.x + z * PIER_DIR.y;
  const across = x * PIER_SIDE.x + z * PIER_SIDE.y;
  return along > PIER_START - margin && along < PIER_END + margin && Math.abs(across) < PIER_HALF_W + margin;
}

/** Ground height under (x, z): lawn 0, sand slopes down, the pier deck on top. */
export function groundHeight(x, z) {
  if (inPier(x, z, -0.05)) return PIER_Y;
  const a = Math.atan2(z, x), r = Math.hypot(x, z);
  const rg = grassRadius(a), rs = shoreRadius(a);
  if (r <= rg) return 0;
  if (r <= rs) return WATER_Y * (r - rg) / (rs - rg);
  return WATER_Y - (r - rs) * 0.5;
}

/** Where you can walk: lawn, beach down to the waterline, and the pier. */
export function walkable(x, z) {
  return Math.hypot(x, z) < shoreRadius(Math.atan2(z, x)) - 0.12 || inPier(x, z, -0.08);
}

// Box-projected UVs in world units, for the glTF meshes that came without UVs.
function boxUVs(mesh, tile) {
  const g = mesh.geometry;
  mesh.updateMatrixWorld(true);
  const pos = g.attributes.position, nrm = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(nrm, i).applyMatrix3(nm);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u, w;
    if (ay >= ax && ay >= az) { u = v.x; w = v.z; } else if (ax >= az) { u = v.z; w = v.y; } else { u = v.x; w = v.y; }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = w / tile;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

// White corrugated metal: thin light/shade stripes.
function corrugatedTexture() {
  const cv = document.createElement("canvas");
  cv.width = 32; cv.height = 4;
  const c = cv.getContext("2d");
  const grad = c.createLinearGradient(0, 0, 32, 0);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.45, "#f4f6f9");
  grad.addColorStop(0.62, "#aab3c0"); // shaded flank of each rib
  grad.addColorStop(0.8, "#e9edf2");
  grad.addColorStop(1, "#ffffff");
  c.fillStyle = grad;
  c.fillRect(0, 0, 32, 4);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });

function add(parent, geo, material, x = 0, y = 0, z = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}

// A flat ribbon following a curve on the ground (track lanes, lines).
function ribbon(curve, width, y, material, offset = 0, samples = 120) {
  const pos = [], uv = [], idx = [];
  const pts = curve.getSpacedPoints(samples);
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const t = new THREE.Vector2(q.x - o.x, q.z - o.z).normalize();
    const nx = -t.y, nz = t.x;
    if (i) len += p.distanceTo(pts[i - 1]);
    for (const s of [-1, 1]) {
      const d = offset + s * width / 2;
      pos.push(p.x + nx * d, y, p.z + nz * d);
      uv.push((s + 1) / 2, len);
    }
    if (i) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // counter-clockwise from above
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.15, -0.3, -0.62, -0.05, -0.55, 0.28);
  s.bezierCurveTo(-0.5, 0.58, -0.12, 0.62, 0, 0.32);
  s.bezierCurveTo(0.12, 0.62, 0.5, 0.58, 0.55, 0.28);
  s.bezierCurveTo(0.62, -0.05, 0.15, -0.3, 0, -0.5);
  return s;
}

/** A puffy 3D heart about `size` wide, centred on its origin, facing +z. */
export function makeHeart(size, material) {
  const g = new THREE.ExtrudeGeometry(heartShape(), {
    depth: 0.18, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 10,
  });
  g.center();
  g.scale(size, size, size);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

/**
 * Restyle the exported island and add the new pieces.
 * Returns colliders, occluder groups, NPC spots and a per-frame update.
 */
export function buildWorld(scene, root) {
  const byName = (n) => root.getObjectByName(n.replace(/ /g, "_"));
  const circles = [], boxes = [], occluders = [];
  const updaters = [];

  // Drop what the new design replaces.
  const drop = [];
  root.traverse((o) => {
    if (/^(Ground|Driveway|Red_Truck|Family|Path_Stone_\d|Tree_\d_.*)$/.test(o.name)) drop.push(o);
  });
  drop.forEach((o) => o.removeFromParent());

  // ---- House: brick walls, white corrugated roof ----
  const brick = texture("brick", 0.9);
  const brickMat = std({ map: brick, roughness: 0.95 });
  const roofTex = corrugatedTexture();
  const roofMat = std({ map: roofTex, color: 0xffffff, roughness: 0.55, metalness: 0.05 });
  const frameMat = std({ color: COLORS.white });
  const glassMat = std({ color: 0x5f7f8f, roughness: 0.2, metalness: 0.1 });
  const doorMat = std({ color: 0x8a5634 });
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const n = o.name;
    if (n === "Walls" || n.startsWith("Chimney")) { o.material = brickMat; boxUVs(o, 0.9); }
    else if (n === "Roof") { o.material = roofMat; boxUVs(o, 0.13); }
    else if (/Glass$/.test(n)) o.material = glassMat;
    else if (/(Frame|Sill|Knob)$/.test(n) || n === "Step") o.material = frameMat;
    else if (n === "Door") o.material = doorMat;
    else if (/^Bush_\d$/.test(n)) o.material = std({ color: 0xe6f2d6, map: texture("foliage", 0.6) });
    else if (/^Palm_\d+_Trunk$/.test(n)) o.material = std({ color: COLORS.trunk });
    else if (/^Palm_\d+_Frond/.test(n)) o.material = std({ color: Number(n.match(/\d+$/)[0]) % 2 ? COLORS.palmLeaf : COLORS.palmLeafDark, side: THREE.DoubleSide });
    else if (/Coconut/.test(n)) o.material = std({ color: 0x6b4a2b });
    if (/^(Walls|Roof|Chimney|Door|Step|Window)/.test(n)) o.userData.group = "House";
    const palm = n.match(/^(Palm_\d+)_/);
    if (palm) o.userData.group = palm[1];
    if (o.userData.group) occluders.push(o);
  });
  if (byName("Bush 0")) byName("Bush 0").removeFromParent(); // sits where the plaza goes now
  boxes.push({ minX: -1.6, maxX: 1.6, minZ: -1.3, maxZ: 1.34 });

  // ---- Lawn, beach, water ----
  const N = 96;
  const lawnShape = new THREE.Shape();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, r = grassRadius(a);
    const x = Math.cos(a) * r, y = -Math.sin(a) * r; // shape y becomes world -z after rotateX
    i ? lawnShape.lineTo(x, y) : lawnShape.moveTo(x, y);
  }
  const lawnGeo = new THREE.ShapeGeometry(lawnShape, 1);
  lawnGeo.rotateX(-Math.PI / 2);
  const grass = texture("grass", 2.2);
  grass.repeat.set(1 / 2.2, 1 / 2.2);
  add(scene, lawnGeo, std({ map: grass, color: 0xffffff }), 0, 0, 0, { cast: false });

  // Beach: a ring sloping from the lawn edge, through the waterline, under the sea.
  {
    const rows = [[0, 0.0], [1.0, WATER_Y], [1.9, -0.45]]; // [distance past the lawn edge, height]
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2, rg = grassRadius(a);
      for (const [d, h] of rows) {
        const r = rg + d - (d === 0 ? 0.03 : 0);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        pos.push(x, h, z);
        uv.push(x / 1.6, z / 1.6);
      }
      if (i) {
        for (let k = 0; k < rows.length - 1; k++) {
          const a0 = (i - 1) * rows.length + k, b0 = i * rows.length + k;
          idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1); // counter-clockwise from above
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    add(scene, g, std({ map: texture("sand", 1.6), color: 0xfff3e2 }), 0, 0, 0, { cast: false });
  }

  const water = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(0xbfece4) },
      uDeep: { value: new THREE.Color(0x66bccb) },
      uFoam: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vXZ = w.xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShallow, uDeep, uFoam;
      varying vec2 vXZ;
      float shore(float a) { return ${SHORE_R.toFixed(2)} + 0.25 * sin(3.0 * a + 1.0) + 0.15 * sin(5.0 * a + 2.0); }
      void main() {
        float d = length(vXZ) - shore(atan(vXZ.y, vXZ.x)); // distance out from the waterline
        vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 7.0, d));
        float rip = sin(vXZ.x * 2.6 + uTime * 0.7 + sin(vXZ.y * 1.9 + uTime * 0.4)) * sin(vXZ.y * 2.2 - uTime * 0.5);
        col += 0.03 * rip;
        float band = fract(d * 1.3 - uTime * 0.3);
        float foam = smoothstep(0.9, 1.0, band) * (1.0 - smoothstep(0.0, 1.6, d));
        float edge = 1.0 - smoothstep(0.0, 0.22, d);
        col = mix(col, uFoam, clamp(foam * 0.55 + edge * 0.9, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sea = add(scene, new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), water, 0, WATER_Y, 0, { cast: false, receive: false });
  sea.renderOrder = -1;
  updaters.push((dt, t) => { water.uniforms.uTime.value = t; });

  // ---- Salmon paving plaza in front of the house ----
  {
    const s = new THREE.Shape();
    const x0 = -2.4, x1 = 2.4, z0 = 1.15, z1 = 2.75, r = 0.55;
    // shape coords: (x, -z)
    s.moveTo(x0, -z0);
    s.lineTo(x1, -z0);
    s.lineTo(x1, -(z1 - r));
    s.quadraticCurveTo(x1, -z1, x1 - r, -z1);
    s.lineTo(x0 + r, -z1);
    s.quadraticCurveTo(x0, -z1, x0, -(z1 - r));
    s.lineTo(x0, -z0);
    const g = new THREE.ShapeGeometry(s, 8).rotateX(-Math.PI / 2);
    const paving = texture("paving", 1.4);
    paving.repeat.set(1 / 1.4, 1 / 1.4);
    add(scene, g, std({ map: paving, polygonOffset: true, polygonOffsetFactor: -1 }), 0, 0.006, 0, { cast: false });
  }

  // ---- Orange running-track paths with white lines ----
  const trackMat = std({ color: COLORS.orange, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const lineMat = std({ color: COLORS.white, polygonOffset: true, polygonOffsetFactor: -3 });
  const pierFoot = new THREE.Vector3(PIER_DIR.x * (PIER_START + 0.1), 0, PIER_DIR.y * (PIER_START + 0.1));
  const paths = [
    [[0.6, 2.7], [1.0, 3.4], [2.2, 3.75], [3.4, 3.45], pierFoot],
    [[-1.4, 2.7], [-2.5, 2.75], [-3.6, 2.2], [-4.4, 1.45]],
  ];
  for (const pts of paths) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], 0, p[1]))));
    scene.add(ribbon(curve, 0.46, 0.01, trackMat));
    for (const off of [-0.17, 0, 0.17]) scene.add(ribbon(curve, off ? 0.022 : 0.016, 0.014, lineMat, off));
  }

  // ---- White-lined court with a net, beside the house ----
  {
    const cx = -4.45, cz = -0.25, w = 1.5, l = 2.5, lw = 0.035;
    const lines = [[0, -l / 2, w, lw], [0, l / 2, w, lw], [-w / 2, 0, lw, l], [w / 2, 0, lw, l], [0, 0, w, lw]];
    for (const [x, z, sx, sz] of lines) {
      add(scene, new THREE.BoxGeometry(sx, 0.006, sz), lineMat, cx + x, 0.006, cz + z, { cast: false });
    }
    const postMat = std({ color: COLORS.white });
    for (const s of [-1, 1]) {
      add(scene, new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), postMat, cx + s * (w / 2 + 0.08), 0.275, cz);
      circles.push({ x: cx + s * (w / 2 + 0.08), z: cz, r: 0.06 });
    }
    const net = add(scene, new THREE.BoxGeometry(w + 0.16, 0.16, 0.006),
      std({ color: 0xffffff, transparent: true, opacity: 0.7 }), cx, 0.45, cz);
    net.castShadow = true;
  }

  // ---- Wooden benches and a little white café table with chairs ----
  const woodMat = std({ color: COLORS.wood });
  const bench = (x, z, rot) => {
    const g = new THREE.Group();
    add(g, new THREE.BoxGeometry(0.9, 0.06, 0.24), woodMat, 0, 0.2, 0);
    for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.06, 0.18, 0.2), woodMat, s * 0.36, 0.09, 0);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    scene.add(g);
    const along = new THREE.Vector2(Math.cos(rot), -Math.sin(rot));
    for (const t of [-0.3, 0, 0.3]) circles.push({ x: x + along.x * t, z: z + along.y * t, r: 0.16 });
  };
  bench(-1.85, 2.45, 0);
  bench(2.0, 2.45, 0);
  bench(-3.4, -2.2, 0.6);

  const chairMat = std({ color: COLORS.white });
  const cafe = new THREE.Group();
  add(cafe, new THREE.CylinderGeometry(0.16, 0.16, 0.02, 12), chairMat, 0, 0.3, 0);
  add(cafe, new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), chairMat, 0, 0.15, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const ch = new THREE.Group();
    add(ch, new THREE.BoxGeometry(0.14, 0.015, 0.14), chairMat, 0, 0.17, 0);
    add(ch, new THREE.BoxGeometry(0.14, 0.14, 0.015), chairMat, 0, 0.24, -0.07);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      add(ch, new THREE.BoxGeometry(0.012, 0.17, 0.012), chairMat, lx * 0.06, 0.085, lz * 0.06);
    }
    ch.position.set(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
    ch.rotation.y = -a - Math.PI / 2;
    cafe.add(ch);
  }
  cafe.position.set(-2.45, 0, 0.35);
  scene.add(cafe);
  circles.push({ x: -2.45, z: 0.35, r: 0.45 });

  // ---- Fluffy deciduous trees ----
  const foliage = texture("foliage", 0.7);
  const leafMats = [0xffffff, 0xd8ecc4, 0xf2f7d8].map((c) => std({ color: c, map: foliage }));
  const barkMat = std({ color: 0x8a7563 });
  const fluffy = (x, z, s, k) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    add(g, new THREE.CylinderGeometry(0.045 * s, 0.07 * s, 1.0 * s, 6), barkMat, 0, 0.5 * s, 0);
    const blobs = [[0, 1.35, 0, 0.55], [0.32, 1.15, 0.1, 0.4], [-0.3, 1.2, -0.05, 0.42], [0.05, 1.15, 0.33, 0.38], [-0.05, 1.7, -0.08, 0.36], [0.12, 1.25, -0.32, 0.37]];
    blobs.forEach(([bx, by, bz, r], i) => {
      const geo = new THREE.IcosahedronGeometry(r * s, 1);
      const m = add(g, geo, leafMats[(i + k) % 3], bx * s, by * s, bz * s);
      m.rotation.set(i, i * 2, 0);
    });
    g.traverse((o) => { if (o.isMesh) { o.userData.group = `Tree_${k}`; occluders.push(o); } });
    scene.add(g);
    circles.push({ x, z, r: 0.14 * s });
  };
  [[-3.0, -1.35, 1.15], [4.2, -0.9, 1.0], [-2.7, -3.0, 1.2], [2.9, -4.6, 1.05], [-4.7, 3.0, 0.95]]
    .forEach(([x, z, s], k) => fluffy(x, z, s, k));

  // ---- Trunk colliders for the palms ----
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/^Palm_\d+_Trunk$/.test(o.name)) {
      const pos = o.geometry.attributes.position;
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y < 0.25) { sx += v.x; sz += v.z; n++; }
      }
      if (n) circles.push({ x: sx / n, z: sz / n, r: 0.2 });
    } else if (/^Bush_\d$/.test(o.name)) {
      const b = new THREE.Box3().setFromObject(o);
      b.getCenter(v);
      circles.push({ x: v.x, z: v.z, r: (b.max.x - b.min.x) / 2 });
    }
  });

  // ---- Wooden pier ----
  {
    const g = new THREE.Group();
    const plankMat = std({ color: 0xc9935f });
    const postMat = std({ color: 0x7a5236 });
    const len = PIER_END - PIER_START;
    for (let d = 0; d < len; d += 0.16) {
      add(g, new THREE.BoxGeometry(0.13, 0.04, PIER_HALF_W * 2), plankMat, PIER_START + d + 0.07, PIER_Y - 0.02, 0);
    }
    for (let d = 0.6; d <= len; d += 1.1) {
      for (const s of [-1, 1]) {
        add(g, new THREE.CylinderGeometry(0.045, 0.045, 0.9, 6), postMat, PIER_START + d, PIER_Y - 0.4, s * (PIER_HALF_W + 0.02));
      }
    }
    g.rotation.y = -PIER_ANGLE;
    scene.add(g);
  }

  // ---- The boat, moored beside the end of the pier ----
  // boat: position/heading driven by the game; bob: rocks on the waves inside it.
  const boat = new THREE.Group();
  boat.name = "Boat";
  const bob = makeBoat();
  boat.add(bob);
  const moor = PIER_END - 0.9;
  const mooring = new THREE.Vector3(PIER_DIR.x * moor + PIER_SIDE.x * 0.95, WATER_Y, PIER_DIR.y * moor + PIER_SIDE.y * 0.95);
  boat.position.copy(mooring);
  boat.rotation.y = -PIER_ANGLE;
  scene.add(boat);
  updaters.push((dt, t) => {
    bob.position.y = Math.sin(t * 1.3) * 0.035;
    bob.rotation.z = Math.sin(t * 1.1) * 0.035 + (boat.userData.lean || 0);
    bob.rotation.x = Math.sin(t * 0.8) * 0.02;
  });

  // ---- Floating heart above the family ----
  const heartMat = std({ color: 0xd8133a, roughness: 0.35, emissive: 0x5a0010, emissiveIntensity: 0.4 });
  const familyHeart = makeHeart(0.32, heartMat);
  familyHeart.position.set(0.35, 1.08, 2.1);
  scene.add(familyHeart);
  updaters.push((dt, t) => {
    const beat = 1 + 0.12 * Math.max(0, Math.sin(t * 5)) ** 3;
    familyHeart.scale.setScalar(beat);
    familyHeart.position.y = 1.08 + Math.sin(t * 1.3) * 0.03;
    familyHeart.rotation.y = Math.sin(t * 0.7) * 0.4;
  });

  return {
    circles, boxes, occluders, heartMat,
    boat, boatBob: bob,
    dock: {
      mooring, heading: PIER_ANGLE,
      // Where the hero steps off onto the pier, beside the mooring.
      step: new THREE.Vector3(PIER_DIR.x * moor + PIER_SIDE.x * 0.12, PIER_Y, PIER_DIR.y * moor + PIER_SIDE.y * 0.12),
    },
    spots: {
      adult: new THREE.Vector3(0.95, 0, 2.05),
      kids: [new THREE.Vector3(0.38, 0, 2.15), new THREE.Vector3(-0.15, 0, 2.1)],
      player: new THREE.Vector3(-0.9, 0, 2.45),
    },
    update(dt, t) { for (const u of updaters) u(dt, t); },
  };
}

function makeBoat() {
  const boat = new THREE.Group();
  boat.name = "Boat";
  // Hull outline in plan, bow towards +x.
  const s = new THREE.Shape();
  s.moveTo(-0.95, -0.36);
  s.lineTo(0.35, -0.38);
  s.quadraticCurveTo(0.95, -0.3, 1.2, 0);
  s.quadraticCurveTo(0.95, 0.3, 0.35, 0.38);
  s.lineTo(-0.95, 0.36);
  s.lineTo(-0.95, -0.36);
  const hull = new THREE.ExtrudeGeometry(s, { depth: 0.34, bevelEnabled: false, curveSegments: 8 });
  hull.rotateX(-Math.PI / 2); // extrude now points up (+y), shape y -> -z
  // Pinch the keel for a V hull.
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < 0.01) { p.setZ(i, p.getZ(i) * 0.35); p.setX(i, p.getX(i) * 0.92); }
  }
  hull.computeVertexNormals();
  const white = std({ color: 0xf7f6f2, roughness: 0.5, flatShading: true });
  add(boat, hull, white, 0, -0.16, 0);
  // Orange stripe along the gunwale.
  const stripe = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2);
  add(boat, stripe, std({ color: COLORS.orange }), 0, 0.12, 0).scale.set(1.01, 1, 1.03);
  // Wooden deck, little cabin with a windscreen, outboard motor.
  const deck = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  add(boat, deck, std({ color: 0xc9935f }), 0, 0.165, 0).scale.set(0.94, 1, 0.9);
  add(boat, new THREE.BoxGeometry(0.45, 0.22, 0.5), white, 0.1, 0.28, 0);
  const screen = add(boat, new THREE.BoxGeometry(0.03, 0.16, 0.48), std({ color: 0x6fa6c0, roughness: 0.15 }), 0.34, 0.38, 0);
  screen.rotation.z = 0.5;
  add(boat, new THREE.BoxGeometry(0.16, 0.26, 0.14), std({ color: 0x333333 }), -1.02, 0.1, 0);
  add(boat, new THREE.BoxGeometry(0.22, 0.04, 0.3), std({ color: COLORS.white }), -0.6, 0.28, 0); // seat
  boat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return boat;
}
