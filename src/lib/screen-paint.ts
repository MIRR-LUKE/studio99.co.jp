// Paints the visible typography of an (invisible) DOM subtree into a canvas.
// The DOM is the layout engine and the accessible document; the canvas is the
// light that the curved screen projects. Positions come from real line boxes,
// so what you can click and what you see coincide.

type Paint = {
  ctx: CanvasRenderingContext2D;
  originX: number;
  originY: number;
  offsetY: number;
  scale: number;
};

const SKIP = '[data-unprojected],.sr-only,.twin-nav:not(:focus-within),script,style,noscript';
const metrics = new Map<string, { ascent: number; descent: number }>();

function fontOf(style: CSSStyleDeclaration) {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

function measure(ctx: CanvasRenderingContext2D, font: string) {
  let m = metrics.get(font);
  if (!m) {
    ctx.font = font;
    const t = ctx.measureText('Hgあ');
    m = { ascent: t.fontBoundingBoxAscent || t.actualBoundingBoxAscent, descent: t.fontBoundingBoxDescent || t.actualBoundingBoxDescent };
    metrics.set(font, m);
  }
  return m;
}

function opacityOf(element: Element, root: Element) {
  let value = 1;
  for (let e: Element | null = element; e && e !== root; e = e.parentElement) value *= Number(getComputedStyle(e).opacity || 1);
  return value;
}

function visible(color: string) {
  return color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color);
}

function paintText(node: Text, p: Paint, root: Element) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return 0;
  const text = node.data;
  if (!text.trim()) return 0;
  const style = getComputedStyle(parent);
  if (style.visibility === 'hidden') return 0;
  const alpha = opacityOf(parent, root);
  if (alpha <= .01) return 0;
  const { ctx } = p;
  const font = fontOf(style);
  const { ascent, descent } = measure(ctx, font);
  ctx.font = font;
  ctx.fillStyle = style.color;
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'alphabetic';
  const range = document.createRange();
  let painted = 0;
  // Per character, because CSS letter-spacing and Japanese line breaks are
  // already resolved by the browser's layout.
  for (let i = 0; i < text.length;) {
    const code = text.codePointAt(i)!;
    const length = code > 0xffff ? 2 : 1;
    const char = text.slice(i, i + length);
    if (char.trim()) {
      range.setStart(node, i);
      range.setEnd(node, i + length);
      const rect = range.getClientRects()[0];
      if (rect && rect.width > 0) {
        const baseline = rect.top + ascent * (rect.height / Math.max(1, ascent + descent));
        ctx.fillText(char, rect.left - p.originX, baseline + p.offsetY - p.originY);
        painted++;
      }
    }
    i += length;
  }
  ctx.globalAlpha = 1;
  return painted;
}

function paintBox(element: HTMLElement, p: Paint, root: Element) {
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const { ctx } = p;
  const alpha = opacityOf(element, root);
  const x = rect.left - p.originX, y = rect.top + p.offsetY - p.originY;
  const w = rect.width, h = rect.height;
  ctx.globalAlpha = alpha;
  if (visible(style.backgroundColor) && style.backgroundImage === 'none') {
    ctx.fillStyle = style.backgroundColor;
    ctx.fillRect(x, y, w, h);
  }
  const edges: [string, string, () => void][] = [
    [style.borderTopWidth, style.borderTopColor, () => ctx.fillRect(x, y, w, parseFloat(style.borderTopWidth))],
    [style.borderBottomWidth, style.borderBottomColor, () => ctx.fillRect(x, y + h - parseFloat(style.borderBottomWidth), w, parseFloat(style.borderBottomWidth))],
    [style.borderLeftWidth, style.borderLeftColor, () => ctx.fillRect(x, y, parseFloat(style.borderLeftWidth), h)],
    [style.borderRightWidth, style.borderRightColor, () => ctx.fillRect(x + w - parseFloat(style.borderRightWidth), y, parseFloat(style.borderRightWidth), h)],
  ];
  for (const [width, color, draw] of edges) {
    if (parseFloat(width) > 0 && style.borderStyle !== 'none' && visible(color)) { ctx.fillStyle = color; draw(); }
  }
  ctx.globalAlpha = 1;
}

// Wrapped lines with the index of their first character (UTF-16 offsets, as
// used by selectionStart), so the projected caret can find the real position.
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: { text: string; start: number }[] = [];
  let offset = 0;
  for (const paragraph of text.split('\n')) {
    let line = '', start = offset;
    for (const char of Array.from(paragraph)) {
      if (ctx.measureText(line + char).width > width && line) { lines.push({ text: line, start }); start += line.length; line = char; } else line += char;
    }
    lines.push({ text: line, start });
    offset += paragraph.length + 1;
  }
  return lines;
}

function paintField(field: HTMLInputElement | HTMLTextAreaElement, p: Paint, root: Element) {
  const style = getComputedStyle(field);
  const rect = field.getBoundingClientRect();
  if (!rect.width) return;
  const { ctx } = p;
  ctx.font = fontOf(style);
  const empty = !field.value;
  const alpha = opacityOf(field, root);
  ctx.globalAlpha = alpha;
  ctx.textBaseline = 'middle';
  const left = rect.left + parseFloat(style.paddingLeft), top = rect.top + parseFloat(style.paddingTop);
  const innerWidth = rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  const multiline = field instanceof HTMLTextAreaElement;
  const text = empty ? field.placeholder : field.value;
  const lines = multiline ? wrap(ctx, text, innerWidth) : [{ text, start: 0 }];
  const maxLines = Math.max(1, Math.floor((rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / lineHeight + .2));
  const focused = document.activeElement === field;
  const caretIndex = focused && !empty ? (field.selectionEnd ?? field.value.length) : 0;
  const caretLine = Math.max(0, lines.findLastIndex(line => line.start <= caretIndex));
  // Keep the caret's line in view, as the real field would.
  const first = focused ? Math.min(Math.max(0, caretLine - maxLines + 1), Math.max(0, lines.length - maxLines)) : Math.max(0, lines.length - maxLines);
  const shown = lines.slice(first, first + maxLines);
  const scrollX = multiline ? 0 : field.scrollLeft;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left - p.originX - 1, rect.top + p.offsetY - p.originY, innerWidth + 2, rect.height);
  ctx.clip();
  // Selection: a faint band behind the selected characters on a single line.
  if (focused && !empty && !multiline && field.selectionStart !== null && field.selectionEnd !== null && field.selectionStart !== field.selectionEnd) {
    const a = ctx.measureText(text.slice(0, field.selectionStart)).width, b = ctx.measureText(text.slice(0, field.selectionEnd)).width;
    ctx.fillStyle = 'rgba(214,206,232,.22)';
    ctx.fillRect(left + a - scrollX - p.originX, top + p.offsetY - p.originY, b - a, lineHeight);
  }
  ctx.fillStyle = empty ? (style.getPropertyValue('--placeholder').trim() || '#655e6b') : style.color;
  shown.forEach((line, i) => {
    ctx.fillText(line.text, left - scrollX - p.originX, top + lineHeight * (i + .5) + p.offsetY - p.originY);
  });
  if (focused) {
    const line = lines[caretLine] ?? { text: '', start: 0 };
    const x = left + (empty ? 0 : ctx.measureText(line.text.slice(0, Math.max(0, caretIndex - line.start))).width) - scrollX + 1;
    const y = top + lineHeight * (caretLine - first);
    ctx.fillStyle = '#f1edf5';
    ctx.fillRect(x - p.originX, y + lineHeight * .18 + p.offsetY - p.originY, 1.2, lineHeight * .64);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function paintFocus(root: Element, p: Paint) {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !root.contains(active) || !active.matches(':focus-visible') || active.matches('input,textarea')) return;
  const rect = active.getBoundingClientRect();
  const { ctx } = p;
  ctx.strokeStyle = 'rgba(244,240,250,.75)';
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.left - 8 - p.originX, rect.top - 6 + p.offsetY - p.originY, rect.width + 16, rect.height + 12);
}

export function paintDom(root: HTMLElement, ctx: CanvasRenderingContext2D, options: { originX: number; originY: number; offsetY: number; scale: number }) {
  const p: Paint = { ctx, ...options };
  let count = 0;
  ctx.save();
  ctx.setTransform(options.scale, 0, 0, options.scale, 0, 0);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT;
      if (node.matches(SKIP)) return NodeFilter.FILTER_REJECT;
      // Visually clipped controls (accessible but hidden) are not light.
      const style = getComputedStyle(node);
      if (style.display === 'none' || /inset\(50%/.test(style.clipPath) || /^rect\(/.test(style.clip)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) count += paintText(node, p, root);
    else if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) { paintBox(node, p, root); paintField(node, p, root); }
    else if (node instanceof HTMLElement) paintBox(node, p, root);
  }
  paintFocus(root, p);
  ctx.restore();
  return count;
}

// Canvas sized to the viewport plus a margin on every side, so the curved
// edges of the screen still have light to bend.
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number, scale: number) {
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}
