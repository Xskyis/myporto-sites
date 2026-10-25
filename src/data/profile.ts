export interface ProfileData {
  name: string;
  nickname: string;
  headline: string;
  role: string;
  location: string;
  tagline: string;
  statusBadge: {
    isOpenToWork: boolean;
    label: string;
    roles: string[];
  };
  bio: string[];
  stats: {
    value: number;
    suffix: string;
    label: string;
    description: string;
  }[];
  awards: {
    title: string;
    category: string;
    issuer: string;
    date: string;
    description: string;
  }[];
  languages: {
    name: string;
    proficiency: string;
    nativeName: string;
  }[];
}

export const PROFILE: ProfileData = {
  name: 'Achmad Nabil Afgareza',
  nickname: 'Nabil',
  role: 'Frontend Developer',
  headline: 'Frontend Developer · Informatics Engineering Student',
  location: 'Malang, East Java, Indonesia',
  tagline: 'Learning by doing.',
  statusBadge: {
    isOpenToWork: true,
    label: 'Open to work',
    roles: ['Frontend Developer', 'Data Entry Specialist'],
  },
  bio: [
    'I am a disciplined Informatics Engineering student at Politeknik Negeri Malang with an insatiable curiosity for emerging technologies and modern web design systems.',
    'My journey across the software landscape is propelled by continuous exploration and a relentless drive to craft fluid, accessible interfaces. Working across freelance AI annotation and production studio internships, I believe the deepest comprehension comes from hands-on execution: building, iterating, and refining.',
    'Anchored in modern JavaScript, React, Next.js, and Tailwind CSS, I approach frontend engineering with an eye for subtle typography, micro-interactions, and purposeful minimalist aesthetics.',
  ],
  stats: [
    {
      value: 57,
      suffix: '',
      label: 'GitHub Repositories',
      description: 'Continuous open exploration & experimentation',
    },
    {
      value: 1,
      suffix: '+ yrs',
      label: 'Professional Experience',
      description: 'Combining studio internship & freelance AI annotation',
    },
    {
      value: 1,
      suffix: 'st',
      label: 'Place National Award',
      description: 'HMTI Intercomp PKM GFT Category',
    },
  ],
  awards: [
    {
      title: '1st Place Winner',
      category: 'PKM GFT Category',
      issuer: 'Malang State Polytechnic HMTI Intercomp (Polinema)',
      date: 'Oct 2024',
      description: 'Awarded first place for innovative written idea and scientific approach in tech development.',
    },
  ],
  languages: [
    {
      name: 'Indonesian',
      nativeName: 'Bahasa Indonesia',
      proficiency: 'Native speaker',
    },
    {
      name: 'English',
      nativeName: 'English',
      proficiency: 'Limited working proficiency',
    },
  ],
};
