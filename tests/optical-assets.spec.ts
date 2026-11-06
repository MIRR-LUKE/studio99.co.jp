import {test,expect} from '@playwright/test';
import {readFile,stat} from 'node:fs/promises';
import {KEYBOARD_LAYOUT} from '../src/lib/keyboard-layout';

test('every rendered shape has a packed optical asset within WebGL texture limits',async()=>{
  const manifest=JSON.parse(await readFile('public/models/motion/manifest.json','utf8'));
  const names=new Set(KEYBOARD_LAYOUT.map(k=>`Keycap_${String(k.u).replace('.','_')}_${k.x< -3?'left':k.x>3?'right':'center'}`));
  expect(manifest.encoding).toBe('RGBM16');
  for(const name of names){
    const size=manifest.variants[name];expect(size,`${name} has motion optics`).toBeTruthy();
    expect(size.revision).toBe(4);
    expect(size.textureWidth).toBeLessThanOrEqual(4096);expect(size.textureHeight).toBeLessThanOrEqual(4096);
    expect(size.file).toMatch(/\.webp$/);expect((await stat(`public/models/motion/${size.file}`)).size).toBeGreaterThan(0);
  }
});

test.skip('all optical atlases upload without GPU or shader errors',async({page})=>{
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-optical-atlas-count','14',{timeout:20000});
  await page.keyboard.type('about');await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/about$/);
  expect(errors).toEqual([]);
});

test.skip('motion download failure retains the interactive glass still',async({page})=>{
  await page.route('**/models/motion/**',route=>route.abort());
  await page.goto('/');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-ready','true',{timeout:20000});
  await expect(page.locator('.is-fallback')).toHaveCount(0);
  await page.keyboard.type('works');await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/works$/);
});
