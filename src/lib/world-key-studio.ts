import * as THREE from 'three';

// The world key's studio, exactly as scripts/render-world-key.py builds it in
// Blender (z-up), expressed in three.js (y-up). The browser traces the same
// keycap through the same cards, so the live key and the Cycles reference match.

/** Blender (x, y, z) → three.js (x, z, −y): the glTF export convention. */
export const fromBlender = (x: number, y: number, z: number, out = new THREE.Vector3()) => out.set(x, z, -y);

const LENS = 128, SENSOR = 36;
export const CAMERA = {
  position: fromBlender(0, -6.4, 1.15),
  target: fromBlender(0, 0, .02),
  /** Vertical = horizontal field of view of the square Cycles frame (degrees). */
  fov: 2 * Math.atan(SENSOR / 2 / LENS) * 180 / Math.PI,
};

/** Paper sweep radiance, calibrated in Blender so AgX shows it as --paper (#e5e4e0). */
export const PAPER: [number, number, number] = [1.9449816942214966, 1.8966429233551025, 1.6316988468170166];
/** The camera side of the light tent: a soft grey (0.2 × paper). */
export const ROOM: [number, number, number] = [PAPER[0] * .2, PAPER[1] * .2, PAPER[2] * .2];
/** The display LUT was written at exposure .65; the world key render used 0. */
export const EXPOSURE = 2 ** -.65;
export const IORS: [number, number, number] = [1.47, 1.535, 1.62];
/** Principled transmission tint and volume absorption (density · (1 − colour)). */
export const TINT: [number, number, number] = [.93, .94, .955];
export const ABSORPTION: [number, number, number] = [.18 * (1 - .82), .18 * (1 - .85), .18 * (1 - .9)];

export type Card = { position: THREE.Vector3; x: THREE.Vector3; y: THREE.Vector3; half: THREE.Vector2; power: number };

/** A plane like Blender's: local Z tracks the target, local Y toward world up, then rolled about Z. */
export function card(location: [number, number, number], size: [number, number], power: number, roll = 0, out?: Card): Card {
  const l = new THREE.Vector3(...location);
  const z = l.clone().negate().normalize();
  const up = new THREE.Vector3(0, 0, 1);
  const y = up.clone().addScaledVector(z, -up.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const x2 = x.clone().multiplyScalar(c).addScaledVector(y, s);
    const y2 = y.clone().multiplyScalar(c).addScaledVector(x, -s);
    x.copy(x2); y.copy(y2);
  }
  const result = out ?? { position: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), half: new THREE.Vector2(), power: 0 };
  fromBlender(l.x, l.y, l.z, result.position);
  fromBlender(x.x, x.y, x.z, result.x);
  fromBlender(y.x, y.y, y.z, result.y);
  result.half.set(size[0] / 2, size[1] / 2);
  result.power = power;
  return result;
}

/** Black flags: the crystal's dark edges and the deep bands inside the walls. */
export const FLAGS: Card[] = [
  card([-2.4, .6, .2], [1.3, 6], 0),
  card([2.3, 2.0, .4], [1.2, 6], 0),
  card([0, -.4, -2.6], [2.4, 2.0], 0),
  card([.4, 2.6, 2.4], [2.6, .5], 0),
];

/** Travelling white softboxes. Each light has its own angle; all 0 = Cycles frame 0. */
export type LightAngles = { side: number; crown: number; strip: number };
export function softboxes(a: LightAngles, out: Card[] = []): Card[] {
  out[0] = card([-3.0 + .9 * Math.sin(a.side + .3), -2.2 + 1.3 * Math.cos(a.side), 1.6 + 1.1 * Math.sin(2 * a.side + .8)], [.42, 4.2], 42, .25 * Math.sin(a.side), out[0]);
  out[1] = card([1.4 * Math.sin(a.crown + 2.0), 2.4 + .4 * Math.cos(2 * a.crown), 3.0 + .5 * Math.sin(a.crown + .9)], [3.2, .22], 30 * (.8 + .2 * Math.sin(a.crown + 1.4)), 0, out[1]);
  out[2] = card([2.5, 1.2 + .5 * Math.sin(a.strip + 2.6), 1.0], [.28, 3.8], 34, -.3, out[2]);
  out[3] = card([-1.4, -3.4, 2.9], [1.6, .5], 7, .5, out[3]);
  return out;
}

/** The key's resting pose at a loop phase (render-world-key.py `pose`), as a three.js Euler. */
export function restingPose(phase: number, out = new THREE.Euler()) {
  const tau = Math.PI * 2;
  const tilt = .44 + .045 * Math.sin(tau * phase + .4) + .018 * Math.sin(2 * tau * phase + 1.9);
  const roll = -.07 + .03 * Math.sin(tau * phase + 2.2);
  const yaw = .34 + .11 * Math.sin(tau * phase + 1.1) + .025 * Math.sin(3 * tau * phase);
  // Blender 'ZYX' = Rx·Ry·Rz; about Blender Y is about three −Z → three 'XZY'.
  return out.set(tilt, yaw, -roll, 'XZY');
}

/** Ink that AgX shows as the page's #131313 (pre-exposure radiance). */
export const INK = .01673;
/** The statement behind the key lies on this plane (three.js z, world units behind the key). */
export const STATEMENT_Z = -.62;

/**
 * The keycap's cross-section rings, from build-optical-keycap.py `optical_key(1)`
 * (Blender z, inset, corner radius) scaled as in its web export (x ·0.7619,
 * depth and height ·0.76), with the dish filled level as in render-world-key.py.
 * three.js: y = height, half-width x, half-depth z, corner radius.
 */
const RINGS: [number, number, number][] = [[-.405, .035, .055], [-.399, .018, .053], [-.383, .005, .052], [-.36, 0, .05],
  [-.33, .003, .05], [-.18, .025, .049], [0, .060, .048], [.18, .104, .048], [.31, .137, .048], [.355, .149, .047], [.382, .164, .047], [.394, .181, .045], [.398, .198, .043]];
const WIDTH_SCALE = (1.06 - .10) / 1.26;
export const PROFILE = RINGS.map(([z, inset, radius]) => ({ y: z * .76, halfX: (.63 - inset) * WIDTH_SCALE, halfZ: (.63 - inset) * .76, radius: radius * .76 }));

/**
 * The profile sampled along the height (Hermite through the rings, tangents by
 * neighbouring differences): half width, half depth, corner radius, and the
 * wall's slope (d half width / d height).
 */
export function profileSamples(count = 256) {
  const y = PROFILE.map(r => r.y);
  const values = PROFILE.map(r => [r.halfX, r.halfZ, r.radius]);
  const tangent = values.map((_, i) => {
    const a = Math.max(0, i - 1), b = Math.min(values.length - 1, i + 1);
    return values[i].map((_, k) => (values[b][k] - values[a][k]) / (y[b] - y[a]));
  });
  const out = new Float32Array(count * 4);
  for (let n = 0; n < count; n++) {
    const at = y[0] + (y[y.length - 1] - y[0]) * n / (count - 1);
    let i = 0; while (i < y.length - 2 && at > y[i + 1]) i++;
    const dy = y[i + 1] - y[i], s = Math.min(1, Math.max(0, (at - y[i]) / dy)), s2 = s * s, s3 = s2 * s;
    const h = [2 * s3 - 3 * s2 + 1, s3 - 2 * s2 + s, -2 * s3 + 3 * s2, s3 - s2];
    const d = [(6 * s2 - 6 * s) / dy, 3 * s2 - 4 * s + 1, (-6 * s2 + 6 * s) / dy, 3 * s2 - 2 * s];
    for (let k = 0; k < 3; k++) out[n * 4 + k] = h[0] * values[i][k] + h[1] * dy * tangent[i][k] + h[2] * values[i + 1][k] + h[3] * dy * tangent[i + 1][k];
    const slope = d[0] * values[i][0] + d[1] * tangent[i][0] + d[2] * values[i + 1][0] + d[3] * tangent[i + 1][0];
    out[n * 4 + 3] = slope;
  }
  return { data: out, bottom: y[0], top: y[y.length - 1] };
}
