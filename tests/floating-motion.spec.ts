import {test,expect} from '@playwright/test';
import {KEYBOARD_LAYOUT} from '../src/lib/keyboard-layout';
import {advanceFloatingKeys,createFloatingKey,setFloatingAttention} from '../src/lib/motion';

test('all-axis drift stays near the key layout, with varied attitudes and tempos',()=>{
  const keys=KEYBOARD_LAYOUT.map(createFloatingKey);
  const ranges=keys.map(()=>({rx:[Infinity,-Infinity],ry:[Infinity,-Infinity],rz:[Infinity,-Infinity]}));
  let horizontal=0,height=0;
  for(let frame=0;frame<60*60;frame++){
    const t=frame/60;advanceFloatingKeys(keys,t,1/60,false,false);
    keys.forEach((k,i)=>{
      if(frame>120)horizontal=Math.max(horizontal,Math.abs(k.x-k.spec.x*1.09),Math.abs(k.z-k.spec.z*1.09));height=Math.max(height,Math.abs(k.y));
      for(const axis of ['rx','ry','rz'] as const){ranges[i][axis][0]=Math.min(ranges[i][axis][0],k[axis]);ranges[i][axis][1]=Math.max(ranges[i][axis][1],k[axis]);}
    });
  }
  expect(horizontal).toBeLessThan(.7);expect(height).toBeLessThan(.8);
  for(const r of ranges){
    for(const axis of ['rx','ry','rz'] as const){expect(r[axis][1]-r[axis][0]).toBeGreaterThan(.025);expect(Math.max(...r[axis].map(Math.abs))).toBeLessThan(.28);}
  }
  const signatures=ranges.map(r=>Object.values(r).flat().map(n=>n.toFixed(3)).join(','));expect(new Set(signatures).size).toBe(keys.length);
});

test('hovered key holds its place while neighbors wander, and resumes on release',()=>{
  const keys=KEYBOARD_LAYOUT.map(createFloatingKey),a=keys.find(k=>k.spec.code==='KeyA')!;
  for(let f=0;f<600;f++)advanceFloatingKeys(keys,f/60,1/60,false,false);
  setFloatingAttention(a,true);const held={...a};const other=keys.find(k=>k.spec.code==='KeyJ')!,beforeOther={...other};
  for(let f=600;f<780;f++)advanceFloatingKeys(keys,f/60,1/60,false,false);
  expect(Math.hypot(a.x-held.x,a.y-held.y,a.z-held.z)).toBeLessThan(.025);
  expect(Math.hypot(a.rx-held.rx,a.ry-held.ry,a.rz-held.rz)).toBeLessThan(.01);
  expect(Math.hypot(other.x-beforeOther.x,other.y-beforeOther.y,other.z-beforeOther.z)).toBeGreaterThan(.05);
  setFloatingAttention(a,false);for(let f=780;f<1020;f++)advanceFloatingKeys(keys,f/60,1/60,false,false);
  expect(Math.hypot(a.x-held.x,a.y-held.y,a.z-held.z)).toBeGreaterThan(.03);
});
