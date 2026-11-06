import {test,expect} from '@playwright/test';
import * as THREE from 'three';
import {KeyBody,modeShape} from '../src/lib/key-physics';
import {card,PROFILE,profileSamples,restingPose} from '../src/lib/world-key-studio';

const rest=()=>({position:new THREE.Vector3(),quaternion:new THREE.Quaternion().setFromEuler(restingPose(0))});
const toWorld=(local:THREE.Vector3,q:THREE.Quaternion)=>local.clone().applyQuaternion(q);
const run=(key:KeyBody,r:ReturnType<typeof rest>,seconds:number)=>{for(let t=0;t<seconds;t+=1/60)key.step(1/60,r.position,r.quaternion);};

test('studio cards match Blender\'s track-to orientation (checked against Blender 5.2)',()=>{
  // Blender: (0,0,0)-(.4,2.6,2.4) .to_track_quat('Z','Y') → X (.9884,-.1521,0), Y (-.1025,-.6661,.7387); here in three.js axes.
  const c=card([.4,2.6,2.4],[2.6,.5],0);
  [[c.x,[.9884,0,.1521]],[c.y,[-.1025,.7387,.6661]]].forEach(([v,e])=>(v as THREE.Vector3).toArray().forEach((x,i)=>expect(x).toBeCloseTo((e as number[])[i],3)));
});
test('the traced profile passes through the keycap generator\'s rings',()=>{
  const {data,bottom,top}=profileSamples(1024);
  expect(bottom).toBeCloseTo(PROFILE[0].y,6);expect(top).toBeCloseTo(PROFILE[PROFILE.length-1].y,6);
  expect(data[0]).toBeCloseTo(PROFILE[0].halfX,5);expect(data[(1024-1)*4]).toBeCloseTo(PROFILE[PROFILE.length-1].halfX,5);
  for(let i=0;i<1024;i++){expect(data[i*4]).toBeGreaterThan(.3);expect(data[i*4]).toBeLessThan(.49);}
});
test('a press dents where it lands: centre squashes, a corner sways and turns the body',()=>{
  const r=rest();
  const centre=new KeyBody();const top=toWorld(new THREE.Vector3(0,.3,0),r.quaternion);
  centre.press(top,new THREE.Vector3(0,-.2,-1).normalize(),r.position,r.quaternion);run(centre,r,.3);
  const corner=new KeyBody();const edge=toWorld(new THREE.Vector3(.44,.3,.4),r.quaternion);
  corner.press(edge,new THREE.Vector3(0,-.2,-1).normalize(),r.position,r.quaternion);run(corner,r,.3);
  expect(centre.q[0]).toBeGreaterThan(.02); // squash
  expect(Math.abs(corner.q[3])+Math.abs(corner.q[1])+Math.abs(corner.q[2])).toBeGreaterThan(Math.abs(centre.q[3])+Math.abs(centre.q[1])+Math.abs(centre.q[2])+.01);
  expect(corner.spin.length()+2*Math.acos(Math.min(1,Math.abs(corner.rotation.w)))).toBeGreaterThan(centre.spin.length()+2*Math.acos(Math.min(1,Math.abs(centre.rotation.w))));
  expect(centre.q[4]).toBeGreaterThan(0); // the dent goes into the body
  expect(modeShape(4,centre.dentCenter,centre.dentCenter,centre.dentDirection).length()).toBeCloseTo(1,5);
});
test('after release it rings briefly and settles; a tug cannot drag it away',()=>{
  const r=rest();const key=new KeyBody();const p=toWorld(new THREE.Vector3(0,.3,0),r.quaternion);
  key.press(p,new THREE.Vector3(0,0,-1),r.position,r.quaternion);
  key.drag(p.clone().add(new THREE.Vector3(3,2,0)));run(key,r,.6);
  expect(key.position.length()).toBeLessThan(.3);
  key.release();run(key,r,3.5);
  expect(key.atRest()).toBe(true);
});
