import type { KeySpec } from './keyboard-layout';

// The last key clears the scene before the HTML world is revealed.
export const DEPARTURE_SECONDS = 1.18;
export const KEY_DEPARTURE_SECONDS = .86;
export const KEY_STAGGER_SECONDS = .26;

export function keyMotionSeed(index: number) {
  const random = (offset: number) => {
    const n = Math.sin((index + 1) * 127.1 + offset * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  return {
    speed: .62 + random(3) * .32,
    delay: random(4) * KEY_STAGGER_SECONDS,
    lift: random(5) * 2 - 1,
    turn: random(6) * 2 - 1,
    driftX:.14+random(7)*.2,driftY:.17+random(8)*.23,driftZ:.12+random(9)*.19,
    pitchTempo:.12+random(10)*.22,yawTempo:.1+random(11)*.21,rollTempo:.14+random(12)*.25,
    pitchRange:.12+random(13)*.09,yawRange:.13+random(14)*.12,rollRange:.09+random(15)*.09,
    angularSpring:6+random(16)*5,angularDrag:3.3+random(17)*1.1,
  };
}
export function smoothNoise(time: number, seed: number) {
  const hash=(n:number)=>{
    const value=Math.sin(n*127.1+seed*311.7)*43758.5453;
    return (value-Math.floor(value))*2-1;
  };
  const cell=Math.floor(time),f=time-cell;
  const blend=f*f*f*(f*(f*6-15)+10);
  return hash(cell)*(1-blend)+hash(cell+1)*blend;
}
const noise=smoothNoise;

export function createFloatingKey(spec: KeySpec, index: number) {
  return {spec,index,seed:keyMotionSeed(index),x:spec.x,y:0,z:spec.z,vx:0,vy:0,vz:0,rx:0,ry:0,rz:0,vrx:0,vry:0,vrz:0,
    engaged:false,hold:{x:spec.x,y:0,z:spec.z,rx:0,ry:0,rz:0},halfX:0,halfZ:0};
}
export type FloatingKey = ReturnType<typeof createFloatingKey>;

export function setFloatingAttention(key:FloatingKey,engaged:boolean){
  if(engaged&&!key.engaged){
    const {x,y,z,rx,ry,rz}=key;Object.assign(key.hold,{x,y,z,rx,ry,rz});
    key.vx*=.12;key.vy*=.12;key.vz*=.12;key.vrx*=.12;key.vry*=.12;key.vrz*=.12;
  }
  key.engaged=engaged;
}

export function advanceFloatingKeys(keys: FloatingKey[], time: number, delta: number, expanding: boolean, reducedMotion: boolean, motionScale=1) {
  const dt=Math.min(delta,.04);
  // A shared, slow gathering rhythm holds the ensemble together. Each key has
  // its own wandering target, inertia and pauses, rather than a repeating bob.
  const spread=expanding?1.23:reducedMotion?1.08:1.09+.02*noise(time*.095,99);
  for(const key of keys){
    const {spec,index,seed}=key;
    // Different clocks for all six axes. Broad wandering gestures mix with
    // smaller corrections; quintic noise naturally accelerates, waits and turns.
    const intent=.72+.28*noise(time*.11,index+31);
    let x=spec.x*spread+(reducedMotion?0:motionScale*(intent*.23*noise(time*seed.driftX,index+3)+.065*noise(time*seed.driftX*2.37,index+103)));
    let y=reducedMotion?0:motionScale*(intent*.53*noise(time*seed.driftY,index+11)+.12*noise(time*seed.driftY*1.83,index+107)+seed.lift*.07);
    let z=spec.z*spread+(reducedMotion?0:motionScale*(intent*.21*noise(time*seed.driftZ,index+17)+.06*noise(time*seed.driftZ*2.13,index+109)));
    const wide=1/Math.sqrt(spec.u);
    let rx=motionScale*seed.pitchRange*(.8*noise(time*seed.pitchTempo,index+23)+.2*noise(time*seed.pitchTempo*2.17,index+127));
    let ry=motionScale*wide*seed.yawRange*(.78*noise(time*seed.yawTempo,index+29)+.22*noise(time*seed.yawTempo*1.93,index+131));
    let rz=motionScale*wide*seed.rollRange*(.75*noise(time*seed.rollTempo,index+37)+.25*noise(time*seed.rollTempo*2.31,index+137));
    if(key.engaged&&!reducedMotion){({x,y,z,rx,ry,rz}=key.hold);}
    if(reducedMotion){key.x=x;key.y=y;key.z=z;key.vx=key.vy=key.vz=key.vrx=key.vry=key.vrz=0;key.rx=key.ry=key.rz=0;}
    else{
    const attraction=7+(seed.lift+1)*3;
    const drag=Math.exp(-(key.engaged?12:3.8+seed.speed)*dt);
    key.vx=(key.vx+(x-key.x)*attraction*dt)*drag;
    key.vy=(key.vy+(y-key.y)*attraction*dt)*drag;
    key.vz=(key.vz+(z-key.z)*attraction*dt)*drag;
    key.x+=key.vx*dt;key.y+=key.vy*dt;key.z+=key.vz*dt;
    const angularDrag=Math.exp(-(key.engaged?12:seed.angularDrag)*dt);
    key.vrx=(key.vrx+(rx-key.rx)*seed.angularSpring*dt)*angularDrag;
    key.vry=(key.vry+(ry-key.ry)*seed.angularSpring*.83*dt)*angularDrag;
    key.vrz=(key.vrz+(rz-key.rz)*seed.angularSpring*1.13*dt)*angularDrag;
    key.rx+=key.vrx*dt;key.ry+=key.vry*dt;key.rz+=key.vrz*dt;
    }
    // Project the rotated box onto the layout plane so wide, yawing keys also
    // make room for their corners. Compute once per key, not once per pair.
    const halfWidth=(spec.u*1.06-.1)*.5,halfDepth=(spec.depth??1)*.48;
    key.halfX=halfWidth*Math.abs(Math.cos(key.ry)*Math.cos(key.rz))+halfDepth*Math.abs(Math.sin(key.ry))+.3*Math.abs(Math.sin(key.rz))+.025;
    key.halfZ=halfDepth*Math.abs(Math.cos(key.ry)*Math.cos(key.rx))+halfWidth*Math.abs(Math.sin(key.ry))+.3*Math.abs(Math.sin(key.rx))+.025;
  }
  // Nearby keys gently make room for one another, including the long keys.
  // Correct only the smallest horizontal overlap so the floating heights stay independent.
  for(let pass=0;pass<2;pass++)for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){
    const a=keys[i],b=keys[j];
    const heightDifference=Math.abs(a.y-b.y);
    if(heightDifference>.8)continue;
    const heightBlend=Math.min(1,Math.max(0,(heightDifference-.4)/.4));
    const contact=1-heightBlend*heightBlend*(3-2*heightBlend);
    const dx=b.x-a.x,dz=b.z-a.z;
    const overlapX=a.halfX+b.halfX-Math.abs(dx);
    const overlapZ=a.halfZ+b.halfZ-Math.abs(dz);
    if(overlapX<=0||overlapZ<=0)continue;
    const mobilityA=a.engaged&&!reducedMotion?0:1,mobilityB=b.engaged&&!reducedMotion?0:1;
    if(mobilityA+mobilityB===0)continue;
    const shareA=mobilityA/(mobilityA+mobilityB),shareB=mobilityB/(mobilityA+mobilityB);
    // Blend contact in as heights converge. A hard height threshold used to
    // push keys sideways in one frame and also made their rainbow jump.
    const settle=reducedMotion?1:1-Math.exp(-18*dt);
    if(overlapX<overlapZ){
      const correction=Math.sign(dx||1)*Math.min(overlapX*settle*contact,reducedMotion?Infinity:dt*1.6);
      a.x-=correction*shareA;b.x+=correction*shareB;a.vx*=.94;b.vx*=.94;
    }else{
      const correction=Math.sign(dz||1)*Math.min(overlapZ*settle*contact,reducedMotion?Infinity:dt*1.6);
      a.z-=correction*shareA;b.z+=correction*shareB;a.vz*=.94;b.vz*=.94;
    }
  }
}
