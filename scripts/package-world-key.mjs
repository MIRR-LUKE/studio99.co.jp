// Cycles reference frame 0 (assets/blender/world-key/frames/000.png, straight
// alpha, AgX) → public/models/world-key/still.webp: the key shown before
// scripts run, without JavaScript and without WebGL. The live key is ray traced
// in the browser (src/components/WorldKey.tsx) from the same studio at phase 0.
// node scripts/package-world-key.mjs
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'assets/blender/world-key/frames/000.png');
const target = path.join(root, 'public/models/world-key/still.webp');
await mkdir(path.dirname(target), { recursive: true });
await sharp(source).webp({ quality: 86, alphaQuality: 100, effort: 6, smartSubsample: true }).toFile(target);
console.log(`still.webp ${((await stat(target)).size / 1024).toFixed(1)} KB`);
