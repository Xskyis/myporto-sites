export interface TimelineItem {
  id: string;
  role: string;
  organization: string;
  period: string;
  location: string;
  type: 'experience' | 'education';
  description: string;
  skills: string[];
  certificateUrl?: string;
  certificatePlaceholder?: boolean;
}

export const TIMELINE: TimelineItem[] = [
  {
    id: 'outlier',
    role: 'Indonesian Contributor',
    organization: 'Outlier',
    period: 'Apr 2025 – Jul 2026',
    location: 'Remote',
    type: 'experience',
    description: 'Evaluated AI model outputs against strict linguistic, accuracy, and reasoning metrics. Formulated structured, actionable feedback to enhance model comprehension and train conversational naturalness in Indonesian speech and text. Core focus on Data Annotation and prompt analysis.',
    skills: ['AI Data Annotation', 'Linguistic Analysis', 'Prompt Evaluation', 'Quality Assurance'],
  },
  {
    id: 'illiyin',
    role: 'Front End Web Developer (Internship)',
    organization: 'Illiyin Studio',
    period: 'Nov 2023 – Apr 2024',
    location: 'Malang, Indonesia (On-site)',
    type: 'experience',
    description: 'Collaborated on production web platforms, translating intricate Figma interfaces into robust, accessible, and performant user journeys using Next.js and modern JavaScript standards.',
    skills: ['Next.js', 'JavaScript', 'Tailwind CSS', 'Git', 'Responsive Design'],
    certificatePlaceholder: true,
    certificateUrl: 'https://drive.google.com/file/d/1uIyiqqmliyslDQC51wBLnF01e6n1fqrI/view?usp=sharing',
  },
  {
    id: 'polinema',
    role: 'Undergraduate Student · Informatics Engineering',
    organization: 'Politeknik Negeri Malang (Polinema)',
    period: 'Jun 2024 – Jul 2028 (Expected)',
    location: 'Malang, Indonesia',
    type: 'education',
    description: 'Pursuing higher degree studies in Informatics Engineering, specializing in modern web frameworks, database administration, software architecture, and collaborative project-based learning.',
    skills: ['Software Engineering', 'Data Structures', 'Database Systems', 'Algorithms'],
  },
  {
    id: 'smk-telkom',
    role: 'Vocational High School Diploma · Software Engineering',
    organization: 'SMK Telkom Malang',
    period: 'Jul 2021 – Jun 2024',
    location: 'Malang, Indonesia',
    type: 'education',
    description: 'Specialized in Software Engineering (RPL). Built core competencies in frontend fundamentals, component-driven development with React.js, modern CSS architectures with Tailwind CSS, and collaborative version control.',
    skills: ['React.js', 'Tailwind CSS', 'JavaScript', 'HTML/CSS', 'Git'],
  },
];
