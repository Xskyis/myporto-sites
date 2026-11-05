export interface HonorItem {
  id: string;
  year: string;
  title: string;
  org: string;
  category: string;
  month: string;
  location: string;
  description: string;
  link?: string;
}

export const HONORS: HonorItem[] = [
  {
    id: 'play-it-2026',
    year: '2026',
    title: 'Best Performance Category',
    org: 'Play IT 2026 National Hackathon',
    category: 'Web Application Hackathon',
    month: 'June',
    location: 'Malang, East Java',
    description:
      'Won 3rd place for best performance in hackathon as part of a team of 3 developers.',
  },
  {
    id: 'hmti-intercomp-2024',
    year: '2024',
    title: '1st Place Winner',
    org: 'Malang State Polytechnic HMTI Intercomp (Polinema)',
    category: 'PKM GFT Category',
    month: 'Oct',
    location: 'Malang, East Java',
    description:
      'Awarded first place for innovative written idea and scientific approach in tech development.',
  },
];

