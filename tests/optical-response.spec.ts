import {test,expect} from '@playwright/test';
import * as THREE from 'three';
import {SIDE_DIRECTIONS,CROWN_DIRECTIONS,bakedLightPosition,createTransportState,localTransportDirection,sampleDirectionalField} from '../src/lib/optical-transport';
import {advanceKeyResponse,createKeyResponse,exciteKey} from '../src/lib/key-response';
import {KEYBOARD_LAYOUT} from '../src/lib/keyboard-layout';
import {advanceFloatingKeys,createFloatingKey,smoothNoise} from '../src/lib/motion';

test('all 77 wandering keys retain continuous optical weights through a minute of physical light motion',()=>{
  const keys=KEYBOARD_LAYOUT.map(createFloatingKey);
  const parent=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,-.07,-.055));
  const states=keys.map(k=>createTransportState(k.spec.x< -3?.26:k.spec.x>3?-.26:0));
  const camera=new THREE.Vector3(0,22.5*.78,22.5*.63);
  const previous=keys.map(()=>[new Float32Array(6),new Float32Array(4)]);
  const weights=[new Float32Array(6),new Float32Array(4)],q=new THREE.Quaternion(),light=new THREE.Vector3();
  let maximumStep=0;
  for(let frame=0;frame<3600;frame++){
    const t=frame/60;advanceFloatingKeys(keys,t,1/60,false,false);
    const angles=[t*.27+1.6*smoothNoise(t*.065,52)+.32*smoothNoise(t*.21,61),t*.19+1.1*smoothNoise(t*.083,83)+.28*smoothNoise(t*.17,97)];
    keys.forEach((key,i)=>{
      const state=states[i];state.position.set(key.x,key.y,key.z).applyQuaternion(parent);state.position.y-=.25;
      state.inverse.copy(parent).multiply(q.setFromEuler(new THREE.Euler(key.rx,key.ry,key.rz))).invert();
      state.view.copy(camera).sub(state.position).normalize().applyQuaternion(state.inverse);
      for(let j=0;j<2;j++){
        bakedLightPosition(j?'crown':'side',angles[j],light);
        const w=sampleDirectionalField(localTransportDirection(state,light),j?CROWN_DIRECTIONS:SIDE_DIRECTIONS,weights[j]);
        if(frame)maximumStep=Math.max(maximumStep,w.reduce((sum,value,n)=>sum+Math.abs(value-previous[i][j][n]),0));
        previous[i][j].set(w);
      }
    });
  }
  // Previous nearest-segment lookup jumped by 2.0 (100% replacement) 565 times.
  expect(maximumStep).toBeLessThan(.12);
  console.log('Optical continuity: largest per-frame L1 weight change',maximumStep);
});

test('transport follows incidence and view, and is invariant under a shared rigid rotation',()=>{
  const state=createTransportState(0);state.view.copy(state.referenceView);
  const light=bakedLightPosition('side',.8);
  const original=localTransportDirection(state,light).clone();
  expect(original.distanceTo(light.clone().normalize())).toBeLessThan(1e-12);
  const rotated=createTransportState(0),rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.2,.4,-.1));
  rotated.inverse.copy(rotation).invert();rotated.view.copy(state.referenceView).applyQuaternion(rotation).applyQuaternion(rotated.inverse);
  expect(localTransportDirection(rotated,light.clone().applyQuaternion(rotation)).distanceTo(original)).toBeLessThan(1e-12);
  rotated.view.copy(state.referenceView).applyAxisAngle(new THREE.Vector3(1,0,0),.18);
  expect(localTransportDirection(rotated,light).distanceTo(original)).toBeGreaterThan(.1);
  for(const [kind,basis] of [['side',SIDE_DIRECTIONS],['crown',CROWN_DIRECTIONS]] as const){
    const a=sampleDirectionalField(bakedLightPosition(kind,.2).normalize(),basis,new Float32Array(basis.length));
    const b=sampleDirectionalField(bakedLightPosition(kind,1.7).normalize(),basis,new Float32Array(basis.length));
    expect(a.reduce((sum,w,i)=>sum+Math.abs(w-b[i]),0)).toBeGreaterThan(.1);
  }
});

test('brief touch rings, settles without a hover-held target, and is stable across frame rates',()=>{
  const trace=(hz:number)=>{
    const s=createKeyResponse();exciteKey(s,'hover');const samples=[];
    for(let i=0;i<hz*2;i++){advanceKeyResponse(s,1/hz,false);samples.push({...s});}
    return samples;
  };
  const a=trace(60),b=trace(30);
  expect(Math.max(...a.map(s=>s.amount))).toBeGreaterThan(.15);
  expect(Math.min(...a.map(s=>s.amount))).toBeLessThan(-.03);
  expect(Math.max(...a.slice(24,54).map(s=>Math.abs(s.twist)))).toBeGreaterThan(.001);
  expect(Math.abs(a.at(-1)!.amount)).toBeLessThan(.001);
  expect(Math.abs(a.at(-1)!.twist)).toBeLessThan(.001);
  expect(Math.abs(a[29].amount-b[14].amount)).toBeLessThan(.005);
  const reduced=createKeyResponse();exciteKey(reduced,'press');advanceKeyResponse(reduced,1/60,false,true);
  expect(reduced.amount).toBe(0);expect(reduced.twist).toBe(0);
});

test.skip('a stationary hovered key settles with no selection highlight or input, then presses with a tail',async({page})=>{
  await page.addInitScript(()=>{try{sessionStorage.setItem('studio99-demo-seen','1');}catch{}});
  await page.goto('/?material&freeze=1');
  await expect(page.locator('html')).toHaveAttribute('data-optical-atlas-count','14',{timeout:20000});
  await page.waitForTimeout(1000);
  const probe=()=>page.evaluate(()=>JSON.parse(document.documentElement.dataset.keyResponse!));
  const baseline=await probe();await page.mouse.move(720,450);
  await expect.poll(async()=>Math.abs((await probe()).amount)).toBeGreaterThan(.03);
  await expect(page.getByTestId('typed-command')).toHaveText('');
  await page.waitForTimeout(2100);
  const settled=await probe();expect(Math.abs(settled.amount)).toBeLessThan(.001);
  expect(settled.side[2]).toBeCloseTo(baseline.side[2],3);
  await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
  await expect(page.getByTestId('typed-command')).toHaveText('A');
  await page.waitForTimeout(350);
  expect(Math.abs((await probe()).twist)).toBeGreaterThan(.001);
});
