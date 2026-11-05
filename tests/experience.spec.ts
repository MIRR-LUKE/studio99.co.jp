import {test,expect} from '@playwright/test';
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-ready','true',{timeout:20000});});
test('prediction waits for Enter, keys depart before navigation, and Escape returns',async({page})=>{
  await page.keyboard.type('abo');await expect(page.getByTestId('prediction')).toContainText('ABOUT');await expect(page.locator('.ghost-text')).toHaveText('UT');
  await page.keyboard.press('Backspace');await expect(page.locator('.ghost-text')).toHaveText('OUT');
  await page.keyboard.type('out');await page.waitForTimeout(1000);await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Enter');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-motion','leaving');
  await page.waitForTimeout(350);await expect(page).toHaveURL(/\/$/);await expect(page.locator('.content-overlay')).toHaveCount(0);
  await expect(page).toHaveURL(/\/about$/);await expect(page.getByRole('heading',{level:1})).toContainText('possibility');
  await page.keyboard.press('Escape');await expect(page).toHaveURL(/\/$/);await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-motion','floating');
});
test('Escape cancels an in-flight departure without a late navigation',async({page})=>{
  await page.keyboard.type('about');await page.keyboard.press('Enter');
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-motion','leaving');
  await page.keyboard.type('x');await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');await page.waitForTimeout(1400);
  await expect(page).toHaveURL(/\/$/);await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');
  await page.keyboard.type('bi');await page.waitForTimeout(900);await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/works\/bi$/);
});
test('navigation links share the departure and browser Back reassembles the keyboard',async({page})=>{
  await page.locator('#site-navigation').getByRole('link',{name:/WORKS/}).click();
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-motion','leaving');
  await expect(page).toHaveURL(/\/works$/);await page.goBack();
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-motion','floating');
  await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');
});
test('reduced motion skips the departure delay',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.keyboard.type('about');const start=Date.now();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/about$/,{timeout:1000});expect(Date.now()-start).toBeLessThan(1000);
});
test('unknown world flows to contact and form typing is isolated',async({page})=>{
  await page.keyboard.type('moon');await expect(page.locator('.unknown-world')).toHaveCount(0);await page.keyboard.press('Enter');
  await expect(page.locator('.unknown-world h1')).toHaveText('MOON_');await page.getByRole('button',{name:'MAKE IT WITH US.'}).click();await expect(page).toHaveURL(/\/contact$/);
  await page.getByLabel('YOUR NAME').fill('ABOUT');await page.waitForTimeout(800);await expect(page).toHaveURL(/\/contact$/);await expect(page.getByLabel('YOUR NAME')).toHaveValue('ABOUT');
});
test('modifier hints, browser shortcuts, simultaneous input and blur cleanup',async({page})=>{
  await page.keyboard.down('Control');await expect(page.getByRole('region',{name:'Known worlds'})).toBeVisible();
  await page.keyboard.press('a');await expect(page.getByTestId('typed-command')).toHaveCount(0);await page.keyboard.up('Control');
  await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');
  await page.keyboard.down('a');await page.keyboard.down('b');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-pressed',/KeyA,KeyB/);
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-pressed','');
  await page.keyboard.up('a');await page.keyboard.up('b');
});
test('Space expansion and Shift release',async({page})=>{
  await page.keyboard.down('Space');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-expanding','true');await page.keyboard.up('Space');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-expanding','false');
  await page.keyboard.down('Shift');await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-pressed',/ShiftLeft/);await page.keyboard.up('Shift');
});
test('IME does not accidentally trigger global commands',async({page})=>{
  await page.evaluate(()=>{document.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'a',code:'KeyA',isComposing:true,bubbles:true}));document.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'あ'}));});
  await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');
});
test('URLs and browser history preserve content navigation',async({page})=>{
  await page.goto('/works/rubicon');await expect(page.getByRole('heading',{level:1})).toContainText('RUBICON');await page.getByRole('link',{name:'ALL WORLDS'}).click();await expect(page).toHaveURL(/\/works$/);
  await page.goBack();await expect(page).toHaveURL(/\/works\/rubicon$/);await expect(page.getByRole('heading',{level:1})).toContainText('RUBICON');
});
test('actual 3D raycast clicks enter letters and pointer release clears the key',async({page})=>{
  await page.waitForTimeout(500);
  await page.mouse.move(276,438);await page.mouse.down();
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-pressed',/KeyA/);
  await expect(page.getByTestId('typed-command')).toHaveText('A');
  await page.mouse.up();await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-pressed','');
});
test('mobile text input opens unknown worlds without horizontal overflow',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();await page.goto('/');
  await page.getByRole('button',{name:'TAP TO TYPE'}).click();
  await page.getByLabel('Your world',{exact:true}).fill('moon');await page.getByRole('button',{name:'Open this world'}).click();
  await expect(page.locator('.unknown-world h1')).toHaveText('MOON_');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button',{name:'BACK TO YOUR WORLD'}).click();await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');await context.close();
});
test('WebGL unavailable still exposes navigation and command input',async({page})=>{
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:unknown[]){if(type.includes('webgl'))return null;return original.apply(this,[type,...args] as never); } as typeof original;
  });
  await page.goto('/');await expect(page.locator('.fallback-note')).toBeVisible();
  await page.locator('#site-navigation').getByRole('link',{name:/ABOUT/}).click();await expect(page.getByRole('heading',{level:1})).toContainText('possibility');
});
test('server-rendered company and project content works without JavaScript',async({browser})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  await page.goto('/about');await expect(page.getByRole('heading',{level:1})).toContainText('possibility');
  await page.locator('#site-navigation').getByRole('link',{name:/WORKS/}).click();await expect(page.getByRole('link',{name:/Beauty Institute/})).toBeVisible();await context.close();
});
