// The 3D chess board (three.js). It knows nothing about hidden data: it is
// told where the pieces are, which move to animate and which moves to hint at.
//
// World layout: one square = 1 unit. File a..h runs along +x, rank 1..8 runs
// towards -z, so White sits near the camera.
import * as THREE from "../vendor/three.js";
import { OrbitControls, RoomEnvironment, mergeGeometries } from "../vendor/three.js";

const AMBER = 0xe9b44c;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// "e4" -> position of the centre of that square
function squareToWorld(square, y = 0) {
  const file = square.charCodeAt(0) - 97; // a = 0
  const rank = Number(square[1]) - 1;
  return new THREE.Vector3(file - 3.5, y, 3.5 - rank);
}

// ---------- piece shapes ----------
//
// Most chess pieces are "turned" shapes, like on a lathe: draw the outline of
// one side (radius, height) and spin it around the vertical axis.

const lathe = (points) =>
  new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), 48);

const ball = (radius, y, x = 0, z = 0) =>
  new THREE.SphereGeometry(radius, 24, 16).translate(x, y, z);

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// The foot that every piece shares, scaled by its radius.
const foot = (r) => [
  [0, 0], [r, 0], [r, 0.05], [r * 0.9, 0.09], [r * 0.72, 0.13], [r * 0.6, 0.18],
];

function ringOf(count, radius, make) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    parts.push(make(Math.cos(angle) * radius, Math.sin(angle) * radius, angle));
  }
  return parts;
}

function knightHead() {
  // Side view of a horse's head, drawn clockwise from the back of the neck.
  const outline = new THREE.Shape();
  outline.moveTo(-0.2, 0.26);
  outline.bezierCurveTo(-0.32, 0.5, -0.27, 0.86, -0.07, 1.01); // arched neck and mane
  outline.lineTo(-0.03, 1.14); // ear
  outline.lineTo(0.05, 1.0);
  outline.bezierCurveTo(0.17, 0.95, 0.3, 0.8, 0.37, 0.62); // forehead down to the nose
  outline.bezierCurveTo(0.39, 0.55, 0.36, 0.49, 0.27, 0.49); // muzzle
  outline.bezierCurveTo(0.2, 0.55, 0.15, 0.63, 0.09, 0.66); // jaw
  outline.bezierCurveTo(0.0, 0.52, 0.12, 0.38, 0.23, 0.26); // throat and chest
  outline.closePath();
  const head = new THREE.ExtrudeGeometry(outline, {
    depth: 0.14, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.035,
    bevelSegments: 4, curveSegments: 16,
  });
  return head.translate(0, 0, -0.07);
}

function buildGeometries() {
  const parts = {
    p: [
      lathe([...foot(0.29), [0.13, 0.3], [0.09, 0.44], [0.17, 0.47], [0.17, 0.51], [0.08, 0.54], [0, 0.54]]),
      ball(0.145, 0.66),
    ],
    r: [
      lathe([...foot(0.33), [0.21, 0.3], [0.19, 0.6], [0.27, 0.66], [0.27, 0.8], [0, 0.8]]),
      // battlements around the top
      ...ringOf(6, 0.215, (x, z, angle) =>
        new THREE.BoxGeometry(0.11, 0.12, 0.15).rotateY(-angle).translate(x, 0.86, z)),
    ],
    n: [
      lathe([...foot(0.33), [0.24, 0.22], [0.25, 0.27], [0, 0.27]]),
      knightHead(),
    ],
    b: [
      lathe([...foot(0.31), [0.12, 0.36], [0.09, 0.58], [0.18, 0.61], [0.18, 0.65], [0.1, 0.68],
        [0.15, 0.76], [0.165, 0.84], [0.14, 0.93], [0.08, 1.01], [0, 1.05]]),
      ball(0.05, 1.08),
    ],
    q: [
      lathe([...foot(0.35), [0.14, 0.42], [0.1, 0.78], [0.2, 0.81], [0.2, 0.85], [0.12, 0.88],
        [0.15, 1.0], [0.23, 1.14], [0.19, 1.14], [0.13, 1.08], [0, 1.08]]),
      ball(0.15, 1.08),
      ball(0.05, 1.26),
      ...ringOf(8, 0.21, (x, z) => ball(0.04, 1.16, x, z)), // points of the crown
    ],
    k: [
      lathe([...foot(0.36), [0.15, 0.44], [0.11, 0.84], [0.21, 0.87], [0.21, 0.91], [0.13, 0.94],
        [0.16, 1.04], [0.23, 1.2], [0.2, 1.24], [0, 1.26]]),
      box(0.07, 0.28, 0.07, 0, 1.4, 0), // the cross
      box(0.21, 0.07, 0.07, 0, 1.42, 0),
    ],
  };
  const geometries = {};
  for (const [type, list] of Object.entries(parts)) {
    // Merging needs every part in the same format (no shared-vertex index).
    geometries[type] = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
  }
  return geometries;
}

// ---------- the board ----------

// The top of the board is one image painted on a canvas: 64 squares, a frame
// and the a-h / 1-8 labels.
function paintBoardTop(canvas) {
  const size = canvas.width;
  const ctx = canvas.getContext("2d");
  const unit = size / 8.8; // 8 squares + a 0.4 frame on each side
  const edge = unit * 0.4;
  ctx.fillStyle = "#171c1b";
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#cfc7b0" : "#3d564d";
      ctx.fillRect(edge + col * unit, edge + row * unit, unit + 0.5, unit + 0.5);
    }
  }
  ctx.fillStyle = "#77817b";
  ctx.font = `500 ${unit * 0.17}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 8; i++) {
    ctx.fillText("abcdefgh"[i], edge + (i + 0.5) * unit, size - edge / 2);
    ctx.fillText(String(8 - i), edge / 2, edge + (i + 0.5) * unit);
  }
}

export class Board3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.pieces = new Map(); // "e4" -> mesh
    this.tweens = [];

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;

    this.scene = new THREE.Scene();
    // A soft "studio" for the pieces to reflect; no image files needed.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(-5.2, 9.2, 12.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.2, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.38; // never look from below the table
    this.controls.autoRotate = !reducedMotion;
    this.controls.autoRotateSpeed = 0.35;
    // Stop the slow spin for good once the visitor grabs the board.
    this.controls.addEventListener("start", () => (this.controls.autoRotate = false));

    this.#addLights();
    this.#addBoard();
    this.#addHints();

    this.geometries = buildGeometries();
    this.materials = {
      w: new THREE.MeshStandardMaterial({ color: 0xeee4cc, roughness: 0.42 }),
      b: new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.32, metalness: 0.15 }),
    };

    new ResizeObserver(() => this.#resize()).observe(canvas.parentElement);
    this.#resize();
    this.renderer.setAnimationLoop((time) => this.#frame(time));
  }

  #addLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8e2, 0x10140f, 0.3));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.2);
    key.position.set(-8, 9.5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.updateProjectionMatrix();
    this.scene.add(key);
    // A warm light from behind picks out the edges of the dark pieces.
    const rim = new THREE.DirectionalLight(AMBER, 0.6);
    rim.position.set(8, 5, -9);
    this.scene.add(rim);
  }

  #addBoard() {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.36, 8.8),
      new THREE.MeshStandardMaterial({ color: 0x171c1b, roughness: 0.5, metalness: 0.2 }));
    slab.position.y = -0.181;
    slab.receiveShadow = true;
    this.scene.add(slab);

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1408;
    paintBoardTop(canvas);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    // Repaint the labels once the web font has arrived.
    document.fonts?.ready.then(() => {
      paintBoardTop(canvas);
      texture.needsUpdate = true;
    });
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(8.8, 8.8),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55 }));
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);

    // An invisible floor that only shows the board's shadow.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 48), new THREE.ShadowMaterial({ opacity: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.37;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  // Flat markers drawn on the board: last move, candidate moves, hovered move.
  #addHints() {
    const flat = (opacity) => new THREE.MeshBasicMaterial({
      color: AMBER, transparent: true, opacity, depthWrite: false,
    });
    const tile = () => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flat(0.3));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    };
    this.lastTiles = [tile(), tile()];

    // Thin lines from each piece to every square it could move to.
    this.fan = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0.32, depthWrite: false }));
    this.fan.position.y = 0.012;
    this.scene.add(this.fan);

    this.arrow = new THREE.Mesh(new THREE.BufferGeometry(), flat(0.95));
    this.arrow.visible = false;
    this.scene.add(this.arrow);
  }

  #resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas.parentElement;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Keep the whole board in view on narrow (phone) screens: move the camera
    // back along its current direction.
    const distance = THREE.MathUtils.clamp(15 / Math.min(1, this.camera.aspect * 0.7), 14, 44);
    this.controls.minDistance = distance * 0.55;
    this.controls.maxDistance = distance * 1.5;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
  }

  #frame(time) {
    // The idle motion is a slow sway of about 20 degrees each way, not a
    // full spin: the board should never end up side-on while a game plays.
    if (this.controls.autoRotate) {
      this.homeAngle ??= this.controls.getAzimuthalAngle();
      const offset = Math.abs(this.controls.getAzimuthalAngle() - this.homeAngle);
      if (offset > 0.35 && offset > this.lastOffset) this.controls.autoRotateSpeed *= -1;
      this.lastOffset = offset;
    }
    this.controls.update();
    this.tweens = this.tweens.filter((tween) => !tween(time));
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- pieces ----------

  #makePiece(type, color) {
    const mesh = new THREE.Mesh(this.geometries[type], this.materials[color]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Knights look across the board, turned well to one side so that their
    // profile (the only part that says "horse") shows from the usual camera.
    if (type === "n") mesh.rotation.y = (color === "w" ? 1 : -1) * (Math.PI / 2 + 0.95);
    return mesh;
  }

  // Put the pieces down with no animation. `pieces` is a list of
  // { square: "e4", type: "n", color: "w" }.
  setPosition(pieces) {
    this.#finishTweens();
    for (const mesh of this.pieces.values()) this.scene.remove(mesh);
    this.pieces.clear();
    for (const { square, type, color } of pieces) {
      const mesh = this.#makePiece(type, color);
      mesh.position.copy(squareToWorld(square));
      this.scene.add(mesh);
      this.pieces.set(square, mesh);
    }
  }

  // Animate one move. `move` is
  //   { from, to, captured?: square, rook?: { from, to }, promotion?: type, color }
  animateMove(move, duration) {
    this.#finishTweens();
    if (reducedMotion) duration = 0;
    const victim = move.captured && this.pieces.get(move.captured);
    if (victim) {
      this.pieces.delete(move.captured);
      this.#tween(duration * 0.8, (t) => {
        victim.scale.setScalar(1 - t);
        victim.position.y = -0.3 * t;
      }, () => this.scene.remove(victim));
    }
    this.#slide(move.from, move.to, duration, () => {
      if (move.promotion) this.pieces.get(move.to).geometry = this.geometries[move.promotion];
    });
    if (move.rook) this.#slide(move.rook.from, move.rook.to, duration);
  }

  #slide(from, to, duration, onDone) {
    const mesh = this.pieces.get(from);
    if (!mesh) return;
    this.pieces.delete(from);
    this.pieces.set(to, mesh);
    const start = mesh.position.clone();
    const end = squareToWorld(to);
    const hop = 0.12 + 0.12 * start.distanceTo(end); // longer moves lift higher
    this.#tween(duration, (t) => {
      const eased = t * t * (3 - 2 * t);
      mesh.position.lerpVectors(start, end, eased);
      mesh.position.y = t < 1 ? Math.sin(Math.PI * eased) * hop : 0; // land exactly on the board
    }, onDone);
  }

  // Run update(0..1) every frame for `duration` ms, then onDone().
  #tween(duration, update, onDone) {
    let startTime = null;
    const finish = () => {
      update(1);
      onDone?.();
    };
    const step = (time) => {
      startTime ??= time;
      const elapsed = time - startTime;
      if (elapsed < duration) {
        update(elapsed / duration);
        return false;
      }
      finish();
      return true; // done: #frame removes it from the list
    };
    step.finish = finish; // used to jump to the end when the next move arrives early
    this.tweens.push(step);
  }

  #finishTweens() {
    for (const tween of this.tweens) tween.finish();
    this.tweens = [];
  }

  // ---------- hints ----------

  // Tint the two squares of the move that was just played.
  setLastMove(from, to) {
    [from, to].forEach((square, i) => {
      this.lastTiles[i].visible = Boolean(square);
      if (square) this.lastTiles[i].position.copy(squareToWorld(square, 0.006));
    });
  }

  // Draw a faint line for every candidate move (UCI strings like "e2e4").
  setOptions(ucis) {
    const points = [];
    for (const uci of ucis) {
      const a = squareToWorld(uci.slice(0, 2));
      const b = squareToWorld(uci.slice(2, 4));
      points.push(a.x, 0, a.z, b.x, 0, b.z);
    }
    this.fan.geometry.dispose();
    this.fan.geometry = new THREE.BufferGeometry();
    this.fan.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  }

  // Draw a bold arrow for one move, or hide it with null.
  setArrow(uci) {
    this.arrow.visible = Boolean(uci);
    if (!uci) return;
    const a = squareToWorld(uci.slice(0, 2));
    const b = squareToWorld(uci.slice(2, 4));
    const length = a.distanceTo(b);
    // An arrow pointing along +x, then turned to face the target square.
    const shape = new THREE.Shape();
    const [half, head, wing] = [0.045, 0.34, 0.17];
    shape.moveTo(0.18, -half);
    shape.lineTo(length - head, -half);
    shape.lineTo(length - head, -wing);
    shape.lineTo(length - 0.06, 0);
    shape.lineTo(length - head, wing);
    shape.lineTo(length - head, half);
    shape.lineTo(0.18, half);
    shape.closePath();
    this.arrow.geometry.dispose();
    this.arrow.geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    this.arrow.position.set(a.x, 0.018, a.z);
    this.arrow.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  }
}
