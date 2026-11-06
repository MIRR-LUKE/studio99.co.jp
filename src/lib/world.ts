import {COMMANDS} from './commands';
import {PROJECTS} from './content';

// The URL is the single source of truth for where the visitor is. Every
// in-world state (held keys, raised keys, the projected page) derives from it.
export type World = {
  kind: 'hero' | 'page' | 'unknown';
  path: string;
  word: string;
  parent: string | null;
  items: string[];
  siblings: { prev: string; next: string } | null;
};

export const HERO: World = { kind: 'hero', path: '/', word: '', parent: null, items: [], siblings: null };

function decodeSlug(slug: string) {
  try { return decodeURIComponent(slug).replace(/-/g, ' ').trim(); } catch { return slug.replace(/-/g, ' ').trim(); }
}

export function worldFromPath(pathname: string): World {
  const path = (pathname.split(/[?#]/)[0].replace(/\/+$/, '')) || '/';
  if (path === '/') return HERO;
  const command = COMMANDS.find(c => c.path === path);
  if (command) {
    const index = PROJECTS.findIndex(p => `/works/${p.slug}` === path);
    if (index >= 0) {
      const n = PROJECTS.length;
      return {
        kind: 'page', path, word: command.word, parent: '/works', items: [],
        siblings: { prev: `/works/${PROJECTS[(index + n - 1) % n].slug}`, next: `/works/${PROJECTS[(index + 1) % n].slug}` },
      };
    }
    return { kind: 'page', path, word: command.word, parent: '/', items: path === '/works' ? PROJECTS.map(p => `/works/${p.slug}`) : [], siblings: null };
  }
  const word = decodeSlug(path.slice(1).split('/').join(' ')).toUpperCase().slice(0, 64);
  return { kind: 'unknown', path, word: word || '?', parent: '/', items: [], siblings: null };
}

// Unknown words get their own shareable address. Separators, dots and leading
// underscores never reach the router, so a word can't address a static file.
const RESERVED = new Set(['api', 'next', 'models', 'fonts', 'studies', 'icon-svg', 'about', 'works', 'contact']);
export function unknownPath(word: string) {
  let slug = word.toLowerCase().replace(/[\\/?#.%_]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 64);
  // A trailing hyphen keeps reserved words off real routes; it reads back as the same word.
  if (RESERVED.has(slug)) slug += '-';
  return `/${encodeURIComponent(slug || 'world').replace(/%2D/gi, '-')}`;
}

// Keys whose letters spell the current world stay pressed while you are inside it.
export function heldCodes(word: string, erased = 0) {
  const letters = Array.from(word.toUpperCase()).slice(0, Math.max(0, Array.from(word).length - erased));
  const codes = new Set<string>();
  for (const letter of letters) {
    if (/^[A-Z]$/.test(letter)) codes.add(`Key${letter}`);
    else if (/^[0-9]$/.test(letter)) codes.add(`Digit${letter}`);
  }
  return codes;
}

// Keys that have a job here rise slightly, so they read as touchable without labels.
export function raisedCodes(world: World, typing: boolean) {
  const codes = new Set<string>();
  if (world.kind === 'hero') return codes;
  codes.add('Escape');
  if (typing) { codes.add('Enter'); return codes; }
  world.items.forEach((_, i) => codes.add(`Digit${i + 1}`));
  if (world.siblings) { codes.add('ArrowLeft'); codes.add('ArrowRight'); }
  if (world.kind === 'unknown' || world.path === '/contact') codes.add('Enter');
  return codes;
}
