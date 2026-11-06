import * as THREE from 'three';

// The key is soft crystal jelly hanging in an invisible suspension.
//
// Rigid part: the touched point is pulled by the finger (force at that point),
// so the body both sinks and turns: torque r × F through its inertia tensor.
// Soft part (modal dynamics): the jelly's own shapes of vibration — squash with
// a volume-keeping bulge, sway (shear) in two directions, twist, and a dent at
// the touched point. Each is excited by the same force projected on that
// shape AT THE TOUCHED POINT (generalised force φₖ(c)·F), so a centre press
// squashes, an edge press sways, a corner press twists — and every press
// dents where the finger is. Light damping lets it ring on: ぷるるるん.
// The same shape functions deform the mesh in the vertex shader (jellyGLSL).

export const JELLY = {
  height: .61, radius: .48, bulge: .5, dentWidth: .2,
};

type Mode = { omega: number; zeta: number; mass: number; limit: number };
const hz = (f: number) => f * Math.PI * 2;
// squash, sway x, sway z, twist, dent
// Damping sets the afterglow: every mode decays with about the same time
// constant (ζω ≈ 2.9 /s), so a press gives a few clear ぷるるん cycles and
// settles within about a second, whatever was excited.
export const MODES: Mode[] = [
  { omega: hz(3.1), zeta: .15, mass: .05, limit: .34 },
  { omega: hz(2.5), zeta: .18, mass: .045, limit: .36 },
  { omega: hz(2.5), zeta: .18, mass: .045, limit: .36 },
  { omega: hz(2.1), zeta: .22, mass: .04, limit: .42 },
  { omega: hz(4.2), zeta: .2, mass: .032, limit: .16 },
];

/** Mode shape φₖ at a rest-space point (key local). */
export function modeShape(k: number, v: THREE.Vector3, dentCenter: THREE.Vector3, dentDirection: THREE.Vector3, out = new THREE.Vector3()) {
  const { height: H, radius: R, bulge, dentWidth } = JELLY;
  const yn = v.y / H;
  switch (k) {
    case 0: { const b = bulge * (1.25 - 2 * yn * yn); return out.set(v.x * b / H, -v.y / H, v.z * b / H); }
    case 1: return out.set(yn, 0, 0);
    case 2: return out.set(0, 0, yn);
    case 3: return out.set(-v.z * yn / R, 0, v.x * yn / R);
    default: { const d2 = v.distanceToSquared(dentCenter); return out.copy(dentDirection).multiplyScalar(Math.exp(-d2 / (dentWidth * dentWidth))); }
  }
}

/** GLSL twin of modeShape, summed: rest-space offset of a vertex. */
export const jellyGLSL = /* glsl */`
  uniform vec4 jelly;          // squash, sway x, sway z, twist
  uniform float dent;
  uniform vec3 dentCenter, dentDirection;
  vec3 jellyOffset(vec3 v){
    float H=${JELLY.height.toFixed(3)},R=${JELLY.radius.toFixed(3)},s=${JELLY.dentWidth.toFixed(3)};
    float yn=v.y/H;
    float b=${JELLY.bulge.toFixed(3)}*(1.25-2.0*yn*yn);
    vec3 o=vec3(v.x*b/H,-v.y/H,v.z*b/H)*jelly.x;
    o+=vec3(yn*jelly.y,0.0,yn*jelly.z);
    o+=vec3(-v.z,0.0,v.x)*(yn/R)*jelly.w;
    vec3 d=v-dentCenter;
    o+=dentDirection*dent*exp(-dot(d,d)/(s*s));
    return o;
  }
  // Deformed position and normal (normal through the inverse-transpose Jacobian).
  void jellyDeform(inout vec3 p,inout vec3 n){
    const float e=.004;
    vec3 dx=(jellyOffset(p+vec3(e,0,0))-jellyOffset(p-vec3(e,0,0)))/(2.0*e);
    vec3 dy=(jellyOffset(p+vec3(0,e,0))-jellyOffset(p-vec3(0,e,0)))/(2.0*e);
    vec3 dz=(jellyOffset(p+vec3(0,0,e))-jellyOffset(p-vec3(0,0,e)))/(2.0*e);
    mat3 J=mat3(1.0)+mat3(dx,dy,dz);
    n=normalize(transpose(inverse(J))*n);
    p+=jellyOffset(p);
  }
`;

export type KeyPhysicsParams = {
  mass: number;
  inertia: THREE.Vector3;
  stiffness: number; damping: number;
  angularStiffness: number; angularDamping: number;
  grabStiffness: number; grabDamping: number;
  /** How deep a held press sinks (it creeps there: mochi). */
  pressDepth: number; pressCreep: number;
  contactImpulse: number;
  /** Rotation that drags the jelly behind it (sway/twist lag). */
  inertialCoupling: number;
  modes: Mode[];
};

export const KEY_PHYSICS: KeyPhysicsParams = {
  mass: 1,
  inertia: new THREE.Vector3((.61 ** 2 + .958 ** 2) / 12, (.96 ** 2 + .958 ** 2) / 12, (.96 ** 2 + .61 ** 2) / 12),
  stiffness: 240, damping: 6.2,
  angularStiffness: 22, angularDamping: .72,
  grabStiffness: 240, grabDamping: 7,
  pressDepth: .18, pressCreep: .2,
  contactImpulse: .38,
  inertialCoupling: .045,
  modes: MODES,
};

const t = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), q: new THREE.Quaternion(), qi: new THREE.Quaternion(), dq: new THREE.Quaternion() };

export class KeyBody {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly rotation = new THREE.Quaternion();
  readonly spin = new THREE.Vector3();
  /** Modal amplitudes and velocities: squash, sway x, sway z, twist, dent. */
  readonly q = new Float32Array(5);
  readonly qv = new Float32Array(5);
  readonly dentCenter = new THREE.Vector3(0, .3, 0);
  readonly dentDirection = new THREE.Vector3(0, -1, 0);
  grab: { local: THREE.Vector3; target: THREE.Vector3; normal: THREE.Vector3; anchor: THREE.Vector3; pointer: THREE.Vector3; held: number } | null = null;

  constructor(readonly params: KeyPhysicsParams = KEY_PHYSICS) {}

  orientation(rest: THREE.Quaternion, out = new THREE.Quaternion()) { return out.copy(this.rotation).multiply(rest); }

  private angular(torque: THREE.Vector3, orientation: THREE.Quaternion, out: THREE.Vector3) {
    const inverse = t.qi.copy(orientation).invert();
    const local = out.copy(torque).applyQuaternion(inverse);
    const w = t.d.copy(this.spin).applyQuaternion(inverse);
    const I = this.params.inertia;
    local.sub(w.clone().cross(t.c.set(w.x * I.x, w.y * I.y, w.z * I.z)));
    local.set(local.x / I.x, local.y / I.y, local.z / I.z);
    return local.applyQuaternion(orientation);
  }

  /** Rest-space displacement of the jelly at a rest-space point. */
  displacement(v: THREE.Vector3, out = new THREE.Vector3(), rates = false) {
    out.set(0, 0, 0);
    const amplitudes = rates ? this.qv : this.q;
    for (let k = 0; k < 5; k++) out.addScaledVector(modeShape(k, v, this.dentCenter, this.dentDirection, t.e), amplitudes[k]);
    return out;
  }

  /** Press at a world point along a world ray. */
  press(point: THREE.Vector3, direction: THREE.Vector3, restPosition: THREE.Vector3, rest: THREE.Quaternion) {
    const orientation = this.orientation(rest, t.q);
    const inverse = orientation.clone().invert();
    const center = t.a.copy(restPosition).add(this.position);
    const lever = point.clone().sub(center);
    const local = lever.clone().applyQuaternion(inverse);
    // The touched point in the jelly's rest space (undo its current deformation once).
    local.sub(this.displacement(local, new THREE.Vector3()));
    const normal = direction.clone().normalize();
    // A new dent forms where the finger is, pushed along the finger.
    this.q[4] = 0; this.qv[4] = 0;
    this.dentCenter.copy(local);
    this.dentDirection.copy(normal).applyQuaternion(inverse).normalize();
    this.grab = { local, normal, anchor: point.clone(), pointer: point.clone(), target: point.clone(), held: 0 };
    // Contact impulse: rigid (linear + angular) and into every mode at that point.
    const impulse = normal.clone().multiplyScalar(this.params.contactImpulse);
    this.velocity.addScaledVector(impulse, .45 / this.params.mass);
    this.spin.add(this.angular(lever.cross(impulse.clone().multiplyScalar(.45)), orientation, t.b));
    const localImpulse = impulse.clone().applyQuaternion(inverse);
    for (let k = 0; k < 5; k++) {
      const m = this.params.modes[k];
      this.qv[k] += modeShape(k, local, this.dentCenter, this.dentDirection, t.e).dot(localImpulse) / m.mass * .55;
    }
  }

  /** A held point can be tugged a little, never dragged away. */
  drag(point: THREE.Vector3, limit = .14) {
    if (!this.grab) return;
    const away = t.a.copy(point).sub(this.grab.anchor);
    if (away.length() > limit) away.setLength(limit * (1 + Math.log(away.length() / limit) * .25));
    this.grab.pointer.copy(this.grab.anchor).add(away);
  }

  release() { this.grab = null; }

  step(dt: number, restPosition: THREE.Vector3, rest: THREE.Quaternion, substeps = 4) {
    const p = this.params, h = Math.min(dt, 1 / 20) / substeps;
    const local = new THREE.Vector3();
    for (let s = 0; s < substeps; s++) {
      const orientation = this.orientation(rest, t.q);
      const inverse = new THREE.Quaternion().copy(orientation).invert();
      const force = t.a.copy(this.position).multiplyScalar(-p.stiffness).addScaledVector(this.velocity, -p.damping);
      const torque = rotationVector(this.rotation, t.b).multiplyScalar(-p.angularStiffness).addScaledVector(this.spin, -p.angularDamping);
      const generalised = [0, 0, 0, 0, 0];
      if (this.grab) {
        const g = this.grab;
        g.held += h;
        // Mochi: a held press keeps sinking a little longer before it settles.
        const depth = p.pressDepth * (1 - Math.exp(-g.held / p.pressCreep));
        g.target.copy(g.pointer).addScaledVector(g.normal, depth);
        const shifted = local.copy(g.local).add(this.displacement(g.local, new THREE.Vector3()));
        const lever = shifted.clone().applyQuaternion(orientation);
        const point = lever.clone().add(restPosition).add(this.position);
        const pointVelocity = this.spin.clone().cross(lever).add(this.velocity)
          .add(this.displacement(g.local, new THREE.Vector3(), true).applyQuaternion(orientation));
        const pull = g.target.clone().sub(point).multiplyScalar(p.grabStiffness).addScaledVector(pointVelocity, -p.grabDamping);
        force.add(pull);
        torque.add(lever.cross(pull));
        const pullLocal = pull.clone().applyQuaternion(inverse);
        for (let k = 0; k < 5; k++) generalised[k] = modeShape(k, g.local, this.dentCenter, this.dentDirection, t.e).dot(pullLocal);
      }
      this.velocity.addScaledVector(force, h / p.mass);
      const alpha = this.angular(torque, orientation, new THREE.Vector3());
      this.spin.addScaledVector(alpha, h);
      // Turning drags the jelly behind it: sway lags the spin, twist lags the yaw.
      const a = alpha.applyQuaternion(inverse);
      generalised[1] += p.inertialCoupling * a.z;
      generalised[2] -= p.inertialCoupling * a.x;
      generalised[3] -= p.inertialCoupling * a.y;
      for (let k = 0; k < 5; k++) {
        const m = p.modes[k];
        const acceleration = generalised[k] / m.mass - m.omega * m.omega * this.q[k] - 2 * m.zeta * m.omega * this.qv[k];
        this.qv[k] += acceleration * h;
        this.q[k] = Math.max(-m.limit, Math.min(m.limit, this.q[k] + this.qv[k] * h));
      }
      if (this.spin.length() > 30) this.spin.setLength(30);
      if (this.velocity.length() > 8) this.velocity.setLength(8);
      this.position.addScaledVector(this.velocity, h);
      if (this.position.length() > 1.2) this.position.setLength(1.2);
      const angle = this.spin.length() * h;
      if (angle > 0) {
        t.dq.setFromAxisAngle(t.c.copy(this.spin).normalize(), angle);
        this.rotation.premultiply(t.dq).normalize();
      }
    }
  }

  atRest() {
    let modes = 0;
    for (let k = 0; k < 5; k++) modes = Math.max(modes, Math.abs(this.q[k]), Math.abs(this.qv[k]) * .1);
    return !this.grab && modes < 2e-4 && this.position.length() < 1e-4 && this.velocity.length() < 1e-3
      && rotationVector(this.rotation, t.d).length() < 1e-4 && this.spin.length() < 1e-3;
  }
}

export function rotationVector(q: THREE.Quaternion, out = new THREE.Vector3()) {
  const sign = q.w < 0 ? -1 : 1;
  const w = Math.min(1, q.w * sign);
  const angle = 2 * Math.acos(w);
  const s = Math.sqrt(Math.max(1 - w * w, 0));
  if (s < 1e-6) return out.set(q.x, q.y, q.z).multiplyScalar(2 * sign);
  return out.set(q.x, q.y, q.z).multiplyScalar(sign * angle / s);
}
