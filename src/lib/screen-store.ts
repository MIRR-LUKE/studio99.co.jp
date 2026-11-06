// Shared, mutable state between the DOM twin (layout + accessibility) and the
// WebGL scene. The DOM side writes; the scene reads every rendered frame. No
// React state, so typing never re-renders the 3D tree.

export type ScreenLayer = {
  canvas: HTMLCanvasElement | null;
  version: number;
  // Canvas space: canvasPx = (cssPx - origin) * scale
  originX: number;
  originY: number;
  scale: number;
};

type Rect = { x: number; y: number; width: number; height: number };

export type ScreenStore = {
  viewport: { width: number; height: number };
  margin: number;
  // Light in the void (hero typing, ⌘ map, signatures): the whole screen.
  overlay: ScreenLayer;
  // The page inside the ice display: the twin's scrolling frame.
  page: ScreenLayer & { scroll: number; cssWidth: number; cssHeight: number };
  caret: { x: number; y: number; width: number; height: number; visible: boolean };
  power: number; // 1 while a world is open: the ice display forms
  showPage: boolean; // false while one world gives way to the next
  // Rectangles (CSS px, relative to the canvas): where the keyboard is framed,
  // and where the ice display's readable area (the twin's frame) sits.
  frame: Rect | null;
  display: Rect | null;
  activeUntil: number; // performance.now() until which a reading world keeps rendering
  version: number;
  invalidate: () => void;
};

const layer = (): ScreenLayer => ({ canvas: null, version: 0, originX: 0, originY: 0, scale: 1 });

export const screenStore: ScreenStore = {
  viewport: { width: 1440, height: 900 },
  margin: .16,
  overlay: layer(),
  page: { ...layer(), scroll: 0, cssWidth: 0, cssHeight: 0 },
  caret: { x: 0, y: 0, width: 0, height: 0, visible: false },
  power: 0,
  showPage: true,
  frame: null,
  display: null,
  activeUntil: 0,
  version: 0,
  invalidate: () => {},
};

export function touchScreen() {
  screenStore.version++;
  screenStore.invalidate();
}

// Any interaction keeps an otherwise still reading world rendering briefly.
export function wake(ms = 2400) {
  screenStore.activeUntil = Math.max(screenStore.activeUntil, performance.now() + ms);
  screenStore.invalidate();
}
