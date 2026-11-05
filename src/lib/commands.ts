export const COMMANDS = [
  { word: 'ABOUT', description: 'WHO WE ARE', path: '/about', featured: true },
  { word: 'WORKS', description: 'WHAT WE CREATE', path: '/works', featured: true },
  { word: 'CONTACT', description: 'MAKE ONE WITH US', path: '/contact', featured: true },
  { word: 'RUBICON', description: 'CROSS INTO WHAT’S NEXT', path: '/works/rubicon', featured: false },
  { word: 'BI', description: 'BEAUTY INSTITUTE', path: '/works/bi', featured: false },
  { word: 'ON', description: 'SWITCH ON POSSIBILITY', path: '/works/on', featured: false },
] as const;
export const normalize = (s: string) => s.trim().toUpperCase();
export const resolveCommand = (s: string) => COMMANDS.find(c=>c.word === normalize(s));
export const predictCommands = (s: string) => s.trim() ? COMMANDS.filter(c=>c.word.startsWith(normalize(s))) : [];
