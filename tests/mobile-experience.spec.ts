import {test,expect} from '@playwright/test';
test.skip(true,'The keyboard hero is paused (2026-11-06); see KeyboardExperience.tsx.');

test('mobile uses the same US keys; native ABOUT animates letters and departs before navigation',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();await page.goto('/');
  const scene=page.getByTestId('keyboard-scene');
  await expect(scene).toHaveAttribute('data-layout','us-qwerty');
  await expect(scene).toHaveAttribute('data-key-count','77');
  await expect(page.locator('html')).toHaveAttribute('data-optical-atlas-count','14',{timeout:20000});
  await page.getByRole('button',{name:'Focus command input'}).tap();
  const input=page.getByLabel('Your world',{exact:true});await expect(input).toBeFocused();
  await expect(scene).toHaveAttribute('data-view','mobile-input');
  await input.fill('about');
  await expect(scene).toHaveAttribute('data-strokes',JSON.stringify({KeyA:1,KeyB:1,KeyO:1,KeyU:1,KeyT:1}));
  await page.getByRole('button',{name:'Open this world'}).tap();
  await expect(scene).toHaveAttribute('data-motion','leaving');
  await expect(page.locator('.experience')).not.toHaveClass(/has-native-input/);
  await expect(page).toHaveURL(/\/about$/);
  await page.getByRole('button',{name:'Close world'}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/$/);
  await expect(scene).toHaveAttribute('data-view','mobile-close');
  await context.close();
});

test('breakpoint changes preserve text and US physical key positions',async({page})=>{
  await page.goto('/');await page.keyboard.type('ab');
  await page.setViewportSize({width:390,height:844});
  const scene=page.getByTestId('keyboard-scene');
  await expect(scene).toHaveAttribute('data-view','mobile-close');
  await expect(page.getByTestId('typed-command')).toHaveText('AB');
  await page.keyboard.down('a');await page.keyboard.down('b');await page.keyboard.up('a');
  await expect(scene).toHaveAttribute('data-pressed','KeyB');
  await page.keyboard.up('b');await expect(scene).toHaveAttribute('data-pressed','');
  await page.setViewportSize({width:1440,height:900});
  await expect(scene).toHaveAttribute('data-view','desktop');
  await expect(page.getByTestId('typed-command')).toHaveText('ABAB');
});

test('native editing fits the visual viewport and closing it preserves the word',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();await page.goto('/');
  await page.getByRole('button',{name:'TAP TO TYPE'}).tap();
  const input=page.getByLabel('Your world',{exact:true});await input.fill('moon');
  // Browsers driven by Playwright do not display an OS keyboard. Simulate its
  // visual viewport resize while retaining the full layout viewport.
  await page.evaluate(()=>{
    Object.defineProperty(window.visualViewport,'height',{configurable:true,value:460});
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  const box=await page.locator('.experience').boundingBox();expect(box?.height).toBe(460);
  const inputBox=await input.boundingBox();expect(inputBox!.y+inputBox!.height).toBeLessThan(200);
  const sceneBox=await page.getByTestId('keyboard-scene').boundingBox();expect(sceneBox!.y+sceneBox!.height).toBeLessThanOrEqual(460);
  await page.getByRole('button',{name:'CLOSE KEYBOARD'}).tap();
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-view','mobile-close');
  await expect(page.getByTestId('typed-command')).toHaveText('MOON');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await context.close();
});

test('composition Enter does not open a page and editing with hardware does not double the impact',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'TAP TO TYPE'}).click();
  const input=page.getByLabel('Your world',{exact:true});
  await page.keyboard.type('a');
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-strokes',JSON.stringify({KeyA:1}));
  await input.dispatchEvent('compositionstart');await input.fill('あ');
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-motion','floating');
  await input.dispatchEvent('compositionend',{data:'あ'});
  await expect(input).toHaveValue('あ');await expect(page).toHaveURL(/\/$/);
});


test('the actual mobile glass responds to touch without inserting a character',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();await page.goto('/');
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-ready','true');
  await page.touchscreen.tap(195,460);
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-strokes',JSON.stringify({KeyY:1}));
  await expect(page.getByTestId('typed-command')).toHaveText('TYPE TO EXPLORE');
  await expect(page.getByTestId('keyboard-scene')).toHaveAttribute('data-pressed','');
  await context.close();
});
