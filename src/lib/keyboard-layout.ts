export type KeySpec = { code: string; label: string; key: string; shift?: string; u: number; x: number; z: number; small?: boolean; depth?:number };
type Item = [string, string, string?, number?, string?];
const keys: KeySpec[] = [];
function row(z: number, items: Item[], start = 0) {
  let x = start;
  for (const [code, label, key, u = 1, shift] of items) {
    keys.push({ code, label, key: key ?? label, u, x: x + u / 2 - 7.5, z, shift, small: label.length > 2 });
    x += u;
  }
}
row(-2.85, [['Escape','ESC','Escape']], 0);
for (let i=0;i<12;i++) row(-2.85, [[`F${i+1}`,`F${i+1}`,`F${i+1}`]], 2+i+(i>=4?.3:0)+(i>=8?.3:0));
row(-1.55, [
  ['Backquote','~\n`','`',1,'~'], ...'1234567890'.split('').map((n,i):Item=>[`Digit${n}`,`${'!@#$%^&*()'[i]}\n${n}`,n,1,'!@#$%^&*()'[i]]),
  ['Minus','_\n-','-',1,'_'],['Equal','+\n=','=',1,'+'],['Backspace','BACKSPACE','Backspace',2],
]);
row(-.5, [['Tab','TAB','Tab',1.5], ...'QWERTYUIOP'.split('').map((k):Item=>[`Key${k}`,k,k.toLowerCase()]), ['BracketLeft','{\n[','[',1,'{'],['BracketRight','}\n]',']',1,'}'],['Backslash','|\n\\','\\',1.5,'|']]);
row(.55, [['CapsLock','CAPS','CapsLock',1.75], ...'ASDFGHJKL'.split('').map((k):Item=>[`Key${k}`,k,k.toLowerCase()]), ['Semicolon',':\n;',';',1,':'],['Quote','"\n\'','\'',1,'"'],['Enter','RETURN','Enter',2.25]]);
row(1.6, [['ShiftLeft','SHIFT','Shift',2.25], ...'ZXCVBNM'.split('').map((k):Item=>[`Key${k}`,k,k.toLowerCase()]), ['Comma','<\n,',',',1,'<'],['Period','>\n.','.',1,'>'],['Slash','?\n/','/',1,'?'],['ShiftRight','SHIFT','Shift',2.75]]);
row(2.65,[['ControlLeft','CTRL','Control',1.25],['AltLeft','OPT','Alt',1.25],['MetaLeft','⌘\nCMD','Meta',1.25],['Space','',' ',6.25],['MetaRight','⌘\nCMD','Meta',1.25],['AltRight','OPT','Alt',1.25]]);
row(3.02,[['ArrowLeft','←','ArrowLeft'],['ArrowDown','↓','ArrowDown'],['ArrowRight','→','ArrowRight']],13.25);
row(2.42,[['ArrowUp','↑','ArrowUp']],14.25);
export const KEYBOARD_LAYOUT = keys.map(k=>({...k,x:k.x*1.06-.55,depth:k.code.startsWith('Arrow')?.5:1}));
export const KEY_BY_CODE = Object.fromEntries(KEYBOARD_LAYOUT.map(k=>[k.code,k]));

// Native text keyboards report characters, not physical positions. Only map
// characters that exist on the site's US layout; IME words remain untouched.
export function codeForCharacter(character:string):string|undefined {
  const key=KEYBOARD_LAYOUT.find(k=>k.key===character||k.shift===character||(/^[a-z]$/.test(k.key)&&k.key.toUpperCase()===character));
  return key?.code;
}
