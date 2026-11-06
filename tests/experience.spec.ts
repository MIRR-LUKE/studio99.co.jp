import {test,expect} from '@playwright/test';

test('the hero is a poster: the statement, one live glass key, no keyboard',async({page})=>{
  await page.goto('/');
  await expect(page.getByTestId('world-key')).toHaveAttribute('data-ready','true',{timeout:20000});
  await expect(page.getByRole('heading',{level:1})).toHaveText('WE MAKEWORLDSWITH YOU.');
  await expect(page.locator('.poster-sub')).toContainText('セカイをつくる、クリエイティブパートナー。');
  await expect(page.locator('.poster-top')).toContainText('Studio99®');
  await expect(page.locator('.poster-top')).toContainText('Tokyo / Nagano');
  await expect(page.getByTestId('keyboard-scene')).toHaveCount(0);
  await expect(page.locator('.world-key canvas')).toHaveCount(1);
  // The live key replaces its Cycles still once it has drawn.
  await expect(page.locator('.world-key-still')).toHaveCSS('opacity','0');
  // Typing does nothing now: no command line, no navigation.
  await page.keyboard.type('about');await page.keyboard.press('Enter');await page.waitForTimeout(600);
  await expect(page).toHaveURL(/\/$/);
});
test('the corners lead to every page, and the current page is marked',async({page})=>{
  await page.goto('/');
  await page.locator('.poster-bottom').getByRole('link',{name:'About'}).click();
  await expect(page).toHaveURL(/\/about$/);await expect(page.getByRole('heading',{level:1})).toContainText('possibility');
  await expect(page.locator('.poster-bottom').getByRole('link',{name:'About'})).toHaveAttribute('aria-current','page');
  await page.locator('.poster-bottom').getByRole('link',{name:'Works'}).click();
  await expect(page).toHaveURL(/\/works$/);await page.getByRole('link',{name:/Beauty Institute/}).click();
  await expect(page).toHaveURL(/\/works\/bi$/);await page.goBack();await expect(page).toHaveURL(/\/works$/);
  await page.getByRole('link',{name:'Studio99 home'}).click();await expect(page).toHaveURL(/\/$/);
});
test('unknown addresses are unknown worlds that carry into contact',async({page})=>{
  await page.goto('/moon');await expect(page.getByRole('heading',{level:1})).toHaveText('MOON_');
  await page.getByRole('link',{name:'MAKE IT WITH US'}).click();await expect(page).toHaveURL(/\/contact\?world=MOON$/);
  await expect(page.getByLabel('YOUR WORLD')).toHaveValue(/^MOON — /);
  await page.getByLabel('YOUR NAME').fill('Studio');await page.getByLabel('YOUR NAME').press('Escape');
  await expect(page).toHaveURL(/\/contact/);await expect(page.getByLabel('YOUR NAME')).toHaveValue('Studio');
});
test('reduced motion keeps the key still and ready',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await expect(page.getByTestId('world-key')).toHaveAttribute('data-ready','true',{timeout:20000});
});
test('phones keep the poster without horizontal overflow',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
  await page.goto('/');await expect(page.getByTestId('world-key')).toHaveAttribute('data-ready','true',{timeout:20000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.locator('.poster-bottom').getByRole('link',{name:'Contact'}).tap();await expect(page).toHaveURL(/\/contact$/);
  await context.close();
});
test('without WebGL the Cycles still of the key stays and the poster works',async({page})=>{
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){if(type.includes('webgl'))return null;return original.apply(this,[type,...args] as never); } as typeof original;
  });
  await page.goto('/');
  const still=page.locator('.world-key-still');await expect(still).toBeVisible();
  await expect.poll(()=>still.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth)).toBe(960);
  await expect(page.locator('.world-key canvas')).toHaveCount(0);
  await page.locator('.poster-bottom').getByRole('link',{name:'About'}).click();await expect(page.getByRole('heading',{level:1})).toContainText('possibility');
});
test('pressing the key is felt but goes nowhere',async({page})=>{
  await page.goto('/');await expect(page.getByTestId('world-key')).toHaveAttribute('data-ready','true',{timeout:20000});
  const box=(await page.locator('.world-key-stage').boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(250);
  await page.mouse.move(box.x+box.width/2+300,box.y+box.height/2+200,{steps:6});await page.mouse.up();await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/$/);
});
test('without JavaScript the poster still shows the key',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  await page.goto('/');const still=page.locator('.world-key-still');await expect(still).toBeVisible();
  expect(await still.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth)).toBe(960);
  await context.close();
});
test('server-rendered content works without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  await page.goto('/about');await expect(page.getByRole('heading',{level:1})).toContainText('possibility');
  await page.locator('.poster-bottom').getByRole('link',{name:'Works'}).click();await expect(page.getByRole('link',{name:/Beauty Institute/})).toBeVisible();await context.close();
});
