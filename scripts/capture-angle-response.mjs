import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
const out='docs/qa/angle-response';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function shot(name,query){
  if(query!==undefined){await page.goto(`http://127.0.0.1:3000/?material&freeze=1${query}`);await page.waitForFunction(()=>document.documentElement.dataset.opticalAtlasCount==='14');}
  await page.waitForTimeout(1600);
  await page.screenshot({path:`${out}/${name}.png`,clip:{x:480,y:290,width:500,height:490}});
  return JSON.parse(await page.locator('html').getAttribute('data-key-response'));
}
const probes={};probes.fixed=await shot('fixed','&light=0');probes.later=await shot('fixed-later');
probes.lightOnly=await shot('light-angle','&light=1.8');probes.keyOnly=await shot('key-angle','&light=0&tilt=.2');
const raw=async name=>sharp(`${out}/${name}.png`).removeAlpha().raw().toBuffer();const a=await raw('fixed');
const difference=async name=>{const b=await raw(name);let sum=0,changed=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;if(d>5)changed++;}return {meanByteDifference:sum/a.length,changedChannelsPercent:changed/a.length*100};};
const results={frozen:await difference('fixed-later'),lightOnly:await difference('light-angle'),keyOnly:await difference('key-angle'),probes,errors};
await sharp({create:{width:1500,height:490,channels:3,background:'#030304'}}).composite(await Promise.all(['fixed','light-angle','key-angle'].map(async(name,i)=>({input:await sharp(`${out}/${name}.png`).toBuffer(),left:i*500,top:0})))).png().toFile(`${out}/comparison.png`);
await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));await browser.close();console.log(JSON.stringify(results));
if(errors.length||results.frozen.meanByteDifference>.05||results.lightOnly.meanByteDifference<.5||results.keyOnly.meanByteDifference<.5)process.exitCode=1;
