// Palette values live in `src/styles/global.css` only. Three.js/JS consumers read the CSS
// variables at runtime (portrait.ts) or keep their own render-specific constants (ballpit.ts);
// a second copy here only ever drifted out of sync.
export type PaletteMode = 'mono' | 'color';
export type MonoTone = 'light' | 'dark';
