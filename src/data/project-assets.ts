export interface ProjectImageMeta {
  width: number;
  height: number;
  aspectRatio: number;
  previewWebp: string;
  previewAvif: string;
  avif: string;
}

export const PROJECT_COVER_METAS: Record<string, ProjectImageMeta> = {
  '/projects/DetroitRadiant.webp': {
    width: 1901,
    height: 967,
    aspectRatio: 1901 / 967,
    previewWebp: '/projects/previews/DetroitRadiant.webp',
    previewAvif: '/projects/previews/DetroitRadiant.avif',
    avif: '/projects/DetroitRadiant.avif',
  },
  '/projects/GFU.webp': {
    width: 1280,
    height: 617,
    aspectRatio: 1280 / 617,
    previewWebp: '/projects/previews/GFU.webp',
    previewAvif: '/projects/previews/GFU.avif',
    avif: '/projects/GFU.avif',
  },
  '/projects/jycmp.webp': {
    width: 1350,
    height: 636,
    aspectRatio: 1350 / 636,
    previewWebp: '/projects/previews/jycmp.webp',
    previewAvif: '/projects/previews/jycmp.avif',
    avif: '/projects/jycmp.avif',
  },
  '/projects/SKN.webp': {
    width: 1901,
    height: 971,
    aspectRatio: 1901 / 971,
    previewWebp: '/projects/previews/SKN.webp',
    previewAvif: '/projects/previews/SKN.avif',
    avif: '/projects/SKN.avif',
  },
  '/projects/weather.webp': {
    width: 1897,
    height: 962,
    aspectRatio: 1897 / 962,
    previewWebp: '/projects/previews/weather.webp',
    previewAvif: '/projects/previews/weather.avif',
    avif: '/projects/weather.avif',
  },
};

export function getProjectCoverMeta(coverPath?: string): ProjectImageMeta | null {
  if (!coverPath) return null;
  return PROJECT_COVER_METAS[coverPath] || null;
}

