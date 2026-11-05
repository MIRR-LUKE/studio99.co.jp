import sharp from 'sharp';
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';

const directory='public/models/motion';
const manifest=JSON.parse(await readFile(path.join(directory,'manifest.json'),'utf8'));
if(Object.keys(manifest.variants).length!==14||Object.values(manifest.variants).some(size=>size.revision!==4))throw new Error('Finish all 14 revision 4 Blender variants before packaging.');
let downloadBytes=0,gpuBytes=0;
for(const [name,size] of Object.entries(manifest.variants)){
  const file=`${name}.webp`;
  // Lossless: the alpha channel is an HDR multiplier, never an opacity mask.
  await sharp(path.join(directory,`${name}.png`)).webp({lossless:true,effort:6}).toFile(path.join(directory,file));
  const decoded=await sharp(path.join(directory,file)).raw().toBuffer();
  const source=await sharp(path.join(directory,`${name}.png`)).raw().toBuffer();
  if(!decoded.equals(source))throw new Error(`RGBM changed during encoding: ${name}`);
  size.file=file;size.bytes=(await stat(path.join(directory,file))).size;
  downloadBytes+=size.bytes;gpuBytes+=size.textureWidth*size.textureHeight*4*4/3;
}
manifest.version=4;
manifest.downloadBytes=downloadBytes;
manifest.estimatedAtlasGpuBytes=Math.round(gpuBytes);
await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({variants:Object.keys(manifest.variants).length,downloadMiB:downloadBytes/1048576,atlasGpuMiB:gpuBytes/1048576},null,2));
