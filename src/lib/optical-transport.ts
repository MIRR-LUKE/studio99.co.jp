import * as THREE from 'three';

// Directions actually traced in bake-optical-motion.py. Blender Z-up → glTF Y-up.
// These are a sampled light-transport field, not animation frames.
export function bakedLightPosition(kind:'side'|'crown',angle:number,target=new THREE.Vector3()){
  const x=kind==='side'?27:-6,y=kind==='side'?-21:-12,z=kind==='side'?-6:-12;
  const orbit=kind==='side'?.42*Math.sin(angle):.35*Math.cos(angle);
  const lift=kind==='side'?.65*Math.cos(angle):.42*Math.sin(angle);
  return target.set(x*Math.cos(orbit)-y*Math.sin(orbit),z+lift*6,-x*Math.sin(orbit)-y*Math.cos(orbit));
}
export const SIDE_DIRECTIONS=Array.from({length:6},(_,i)=>bakedLightPosition('side',i*Math.PI/3).normalize());
export const CROWN_DIRECTIONS=Array.from({length:4},(_,i)=>bakedLightPosition('crown',i*Math.PI/2).normalize());

// Continuous spherical radial-basis interpolation. Nearest-segment selection
// jumps across the medial axis of the sampled loop: neighboring keys can cross
// that axis even with tiny rotations. Every directional sample therefore keeps
// a smooth, nonnegative weight. No discrete cell/segment selection, no time lag.
export function sampleDirectionalField(direction:THREE.Vector3,basis:THREE.Vector3[],out:Float32Array){
  // Keep a finite angular footprint for the broad diffusing silk, also while a
  // key turns quickly. Overly narrow kernels turn smooth rotation into a brief
  // near-total transfer between two sparsely sampled light positions.
  const concentration=basis.length===6?55:45;
  let maximum=-Infinity,total=0;
  for(let i=0;i<basis.length;i++)maximum=Math.max(maximum,direction.dot(basis[i]));
  for(let i=0;i<basis.length;i++){out[i]=Math.exp((direction.dot(basis[i])-maximum)*concentration);total+=out[i];}
  for(let i=0;i<basis.length;i++)out[i]/=total;
  return out;
}

export function createTransportState(referenceViewX:number){
  return {inverse:new THREE.Quaternion(),position:new THREE.Vector3(),view:new THREE.Vector3(),light:new THREE.Vector3(),half:new THREE.Vector3(),referenceView:new THREE.Vector3(referenceViewX,.78,.63).normalize()};
}

// Match the reflection half-vector to the fixed Blender camera. This small-angle
// view correction is an approximation for the hero camera, not free-view refraction.
export function localTransportDirection(state:ReturnType<typeof createTransportState>,lightPosition:THREE.Vector3){
  state.light.copy(lightPosition).sub(state.position).normalize().applyQuaternion(state.inverse);
  state.half.copy(state.light).add(state.view).normalize();
  return state.light.copy(state.referenceView).negate().reflect(state.half).normalize();
}
