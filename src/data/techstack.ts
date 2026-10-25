export type TechCategory = 'Frontend' | 'Backend' | 'Mobile' | 'Database' | 'Tools & Cloud';
export type TechLevel = 'Daily use' | 'Comfortable' | 'Learning';

export interface TechItem {
  name: string;
  category: TechCategory;
  level: TechLevel;
  icon: string;
  isPrioritized?: boolean;
  notes?: string;
}

export const TECH_CATEGORIES: TechCategory[] = [
  'Frontend',
  'Backend',
  'Mobile',
  'Database',
  'Tools & Cloud',
];

export const TECH_STACK: TechItem[] = [
  // Prioritized Top Skills
  {
    name: 'Next.js',
    category: 'Frontend',
    level: 'Daily use',
    icon: 'simple-icons:nextdotjs',
    isPrioritized: true,
    notes: 'Primary fullstack/frontend framework for production studio apps',
  },
  {
    name: 'JavaScript (ES6+)',
    category: 'Frontend',
    level: 'Daily use',
    icon: 'simple-icons:javascript',
    isPrioritized: true,
    notes: 'Core language for DOM, APIs, algorithms, and interactive logic',
  },
  {
    name: 'React',
    category: 'Frontend',
    level: 'Daily use',
    icon: 'simple-icons:react',
    isPrioritized: true,
    notes: 'Component-driven user interfaces, hooks, state management',
  },
  {
    name: 'Tailwind CSS',
    category: 'Frontend',
    level: 'Daily use',
    icon: 'simple-icons:tailwindcss',
    isPrioritized: true,
    notes: 'Modern utility-first styling, design token architectures',
  },
  {
    name: 'TypeScript',
    category: 'Frontend',
    level: 'Comfortable',
    icon: 'simple-icons:typescript',
    isPrioritized: true,
    notes: 'Strict typing, robust interfaces, and predictable codebases',
  },
  {
    name: 'Astro',
    category: 'Frontend',
    level: 'Comfortable',
    icon: 'simple-icons:astro',
    notes: 'Content-focused, zero-JS by default, ultra-fast static generation',
  },
  {
    name: 'HTML5 & CSS3',
    category: 'Frontend',
    level: 'Daily use',
    icon: 'simple-icons:html5',
    notes: 'Semantic accessibility, modern CSS grid, subgrid, fluid clamp',
  },

  // Backend
  {
    name: 'Node.js & Express',
    category: 'Backend',
    level: 'Comfortable',
    icon: 'simple-icons:nodedotjs',
    notes: 'RESTful API construction, middlewares, backend services',
  },
  {
    name: 'Laravel / PHP',
    category: 'Backend',
    level: 'Comfortable',
    icon: 'simple-icons:laravel',
    notes: 'Used in PBL projects with Filament admin panels & MVC',
  },
  {
    name: 'Python',
    category: 'Backend',
    level: 'Learning',
    icon: 'simple-icons:python',
    notes: 'Data manipulation, scripts, AI experimentation',
  },
  {
    name: 'Java',
    category: 'Backend',
    level: 'Learning',
    icon: 'lucide:coffee',
    notes: 'Object-oriented programming academic foundations',
  },

  // Mobile
  {
    name: 'Flutter & Dart',
    category: 'Mobile',
    level: 'Comfortable',
    icon: 'simple-icons:flutter',
    notes: 'Cross-platform mobile UI development & on-device ML integrations',
  },

  // Database
  {
    name: 'MySQL',
    category: 'Database',
    level: 'Comfortable',
    icon: 'simple-icons:mysql',
    notes: 'Relational data modeling, indexing, foreign keys, queries',
  },

  // Tools & Cloud
  {
    name: 'Git & GitHub',
    category: 'Tools & Cloud',
    level: 'Daily use',
    icon: 'simple-icons:github',
    isPrioritized: true,
    notes: 'Branch workflows, pull requests, issue tracking, continuous integration',
  },
  {
    name: 'Google Cloud / Vertex AI',
    category: 'Tools & Cloud',
    level: 'Learning',
    icon: 'simple-icons:googlecloud',
    notes: 'Dicoding Google Cloud certification & Vertex AI Prompt Design Badge',
  },
  {
    name: 'AI Data Annotation',
    category: 'Tools & Cloud',
    level: 'Comfortable',
    icon: 'lucide:sparkles',
    notes: 'Model evaluation, linguistic quality assurance (Outlier)',
  },
];
