// Renders the light that lives inside the ice display, for the Blender study.
// One thing per frame, cinema scale, no web marks. Black is "no light".
//   node scripts/render-display-content.mjs
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'assets/blender/display-study');
await mkdir(out, { recursive: true });
// Embedded, because a page without an origin may not load local font files.
const font = `data:font/ttf;base64,${(await readFile(path.join(root, 'public/fonts/dm-sans-variable.ttf'))).toString('base64')}`;

const base = `
  @font-face{font-family:'DM Sans';font-weight:100 1000;src:url('${font}') format('truetype')}
  html,body{margin:0;width:2560px;height:1440px;background:#000;overflow:hidden}
  body{font-family:'DM Sans','Hiragino Sans',sans-serif;color:#f4f1f8;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;-webkit-font-smoothing:antialiased}
`;
const frames = {
  about: `
    <style>${base}
      h1{font-weight:300;font-size:250px;line-height:1.0;letter-spacing:-9px;margin:0 0 100px}
      h1 em{font-style:normal;color:#9a94a6}
      p{font-family:'Hiragino Sans',sans-serif;font-weight:300;font-size:66px;letter-spacing:14px;color:#d9d4e0;margin:0}
    </style>
    <h1>We turn possibility<br>into <em>reality.</em></h1>
    <p>言葉から、まだない世界へ。</p>`,
  unknown: `
    <style>${base}
      h1{font-weight:300;font-size:420px;letter-spacing:-15px;margin:0 0 70px;line-height:1}
      h1 span{color:#8f7fa0}
      p{font-weight:500;font-size:44px;letter-spacing:15px;color:#bdb6c6;margin:0 0 90px}
      a{font-weight:500;font-size:40px;letter-spacing:11px;color:#f4f1f8;padding-bottom:22px;border-bottom:2px solid #ffffff88}
    </style>
    <h1>MOON<span>_</span></h1>
    <p>THIS WORLD DOESN’T EXIST. YET.</p>
    <a>MAKE IT WITH US</a>`,
  works: `
    <style>${base}
      ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:46px}
      li{font-weight:300;font-size:180px;letter-spacing:-6px;line-height:1;color:#5f5a68}
      li.on{color:#f4f1f8}
      small{display:block;font-weight:500;font-size:36px;letter-spacing:12px;margin-top:22px;color:#a39cad}
    </style>
    <ol><li>RUBICON</li><li class="on">Beauty Institute<small>BRAND / DIGITAL</small></li><li>ON</li></ol>`,
};

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
for (const [name, html] of Object.entries(frames)) {
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log('wrote', `${name}.png`);
}
await browser.close();
