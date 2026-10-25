export type PaletteMode = 'mono' | 'color';
export type MonoTone = 'light' | 'dark';

export interface PaletteTheme {
  name: PaletteMode;
  bgPrimary: string;
  bgSurface: string;
  bgSurfaceSoft: string;
  textPrimary: string;
  textMuted: string;
  borderSubtle: string;
  accentPrimary: string;
  accentContrast: string;
  three: {
    background: number;
    wireframe: number;
    accent: number;
    ambientLight: number;
    pointLight: number;
    roughness: number;
    metalness: number;
  };
}

export const PALETTES = {
  monoLight: {
    name: 'mono',
    bgPrimary: '#FAFAF9',
    bgSurface: '#FFFFFF',
    bgSurfaceSoft: '#F5F5F4',
    textPrimary: '#0A0A0A',
    textMuted: '#525252',
    borderSubtle: 'rgba(10, 10, 10, 0.12)',
    accentPrimary: '#0A0A0A',
    accentContrast: '#FAFAF9',
    three: {
      background: 0xfafaf9,
      wireframe: 0x171717,
      accent: 0x0a0a0a,
      ambientLight: 0xffffff,
      pointLight: 0x222222,
      roughness: 0.2,
      metalness: 0.1,
    },
  },
  monoDark: {
    name: 'mono',
    bgPrimary: '#0A0A0A',
    bgSurface: '#121212',
    bgSurfaceSoft: '#1A1A1A',
    textPrimary: '#FAFAF9',
    textMuted: '#A3A3A3',
    borderSubtle: 'rgba(250, 250, 249, 0.12)',
    accentPrimary: '#FAFAF9',
    accentContrast: '#0A0A0A',
    three: {
      background: 0x0a0a0a,
      wireframe: 0xe5e5e5,
      accent: 0xffffff,
      ambientLight: 0xffffff,
      pointLight: 0xffffff,
      roughness: 0.2,
      metalness: 0.8,
    },
  },
  color: {
    name: 'color',
    bgPrimary: '#14288A', // Marine Blue
    bgSurface: '#1C34A8',
    bgSurfaceSoft: '#2A3F77', // Soft secondary tone
    textPrimary: '#FDEEA9', // Cream Yellow (WCAG AA & AAA against marine blue)
    textMuted: '#E5DDA2',
    borderSubtle: 'rgba(253, 238, 169, 0.22)',
    accentPrimary: '#D82B2F', // Bright Red accent
    accentContrast: '#FDEEA9', // Cream Yellow text on Red button
    three: {
      background: 0x14288a,
      wireframe: 0xfdeea9,
      accent: 0xd82b2f,
      ambientLight: 0xffe6a3,
      pointLight: 0xd82b2f,
      roughness: 0.3,
      metalness: 0.6,
    },
  },
} as const;
