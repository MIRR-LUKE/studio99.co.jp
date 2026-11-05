import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

const directory='docs/qa/responsive';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const errors=[],measurements=[];
const open=async(options)=>{
  const context=await browser.newContext(options),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:3000');
  await page.waitForFunction(()=>document.documentElement.dataset.opticalAtlasCount==='14');
  await page.waitForTimeout(1600);
  return {context,page};
};
// Desktop browsers cannot display an iOS/Android system keyboard. Retain the
// full layout viewport, then reproduce the smaller visual viewport it exposes.
const visualHeight=async(page,height)=>page.evaluate(height=>{
  Object.defineProperty(window.visualViewport,'height',{configurable:true,value:height});
  window.visualViewport.dispatchEvent(new Event('resize'));
},height);

for(const [width,height] of [[320,568],[390,844],[430,932],[1440,900]]){
  const {context,page}=await open({viewport:{width,height},deviceScaleFactor:1,isMobile:width<700,hasTouch:width<700,reducedMotion:'reduce'});
  await page.screenshot({path:`${directory}/hero-${width}.png`});
  measurements.push({width,height,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth)});
  if(width<700){
    await page.getByRole('button',{name:'TAP TO TYPE'}).tap();
    await visualHeight(page,width===320?340:460);
    await page.getByLabel('Your world',{exact:true}).fill('abo');
    await page.waitForTimeout(500);
    await page.screenshot({path:`${directory}/native-input-${width}.png`});
    measurements.at(-1).editing={experience:await page.locator('.experience').boundingBox(),input:await page.getByLabel('Your world',{exact:true}).boundingBox(),scene:await page.getByTestId('keyboard-scene').boundingBox()};
  }
  await context.close();
}

const {context,page}=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,recordVideo:{dir:directory,size:{width:390,height:844}}});
await page.waitForTimeout(2600);
await page.touchscreen.tap(195,460);await page.waitForTimeout(1300);
await page.getByRole('button',{name:'TAP TO TYPE'}).tap();
await visualHeight(page,460);await page.waitForTimeout(1200);
const input=page.getByLabel('Your world',{exact:true});
for(const word of ['a','ab','abo','abou','about']){await input.fill(word);await page.waitForTimeout(300);}
await page.waitForTimeout(800);
await page.getByRole('button',{name:'Open this world'}).tap();
await visualHeight(page,844);
await page.waitForURL('**/about');await page.waitForTimeout(600);
await page.getByRole('button',{name:'Close world'}).tap();await page.waitForTimeout(1800);
const video=page.video();await context.close();await video.saveAs(`${directory}/mobile-interaction.webm`);await video.delete();

// Measure without recording video, and with one WebGL page active at a time.
for(const [width,height] of [[390,844],[1440,900]]){
  const {context,page}=await open({viewport:{width,height},deviceScaleFactor:width<700?2:1,isMobile:width<700,hasTouch:width<700});
  const performance=await page.evaluate(async()=>{
    const intervals=[];let previous=await new Promise(resolve=>requestAnimationFrame(resolve));
    for(let i=0;i<180;i++){const now=await new Promise(resolve=>requestAnimationFrame(resolve));intervals.push(now-previous);previous=now;}
    intervals.sort((a,b)=>a-b);
    return {averageFps:1000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),p95FrameMs:intervals[Math.floor(intervals.length*.95)],drawCalls:document.documentElement.dataset.sceneDrawCalls,atlasCount:document.documentElement.dataset.opticalAtlasCount};
  });
  measurements.find(item=>item.width===width).performance=performance;
  await context.close();
}
await browser.close();
await writeFile(`${directory}/results.json`,JSON.stringify({environment:'Desktop Chrome on Apple M1 Pro; mobile touch/viewport emulation, not a physical phone',errors,measurements},null,2));
console.log(JSON.stringify({errors,measurements},null,2));
