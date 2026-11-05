import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('public/models/motion/manifest.json','utf8'));
const filename=manifest.variants.Keycap_1_center.file??'Keycap_1_center.png';
const source=await sharp('public/models/motion/Keycap_1_center.png').raw().toBuffer();
const expected=createHash('sha256').update(source).digest('hex');
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage();
await page.goto('http://127.0.0.1:3000');
const hashes=await page.evaluate(async filename=>{
  const blob=await (await fetch(`/models/motion/${filename}`)).blob();
  const bitmap=await createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'});
  const image=new Image();image.src=URL.createObjectURL(blob);await image.decode();
  const result={};
  for(const [name,input] of [['bitmap',bitmap],['image',image]]){
    const canvas=document.createElement('canvas');const gl=canvas.getContext('webgl2');
    const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,input);
    const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    const pixels=new Uint8Array(input.width*input.height*4);
    gl.readPixels(0,0,input.width,input.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const hash=await crypto.subtle.digest('SHA-256',pixels);
    result[name]=Array.from(new Uint8Array(hash)).map(n=>n.toString(16).padStart(2,'0')).join('');
    gl.deleteFramebuffer(fb);gl.deleteTexture(texture);gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  URL.revokeObjectURL(image.src);bitmap.close();return result;
},filename);
await browser.close();
const report={expected,...hashes,bitmapLossless:hashes.bitmap===expected,imageLossless:hashes.image===expected};
await writeFile('docs/qa/optical-motion/upload-verification.json',JSON.stringify(report,null,2));
console.log(report);
if(!report.bitmapLossless)process.exitCode=1;
