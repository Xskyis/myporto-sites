export interface Certification {
  id: string;
  title: string;
  issuer: string;
  issueDate: string;
  expiryDate?: string;
  credentialUrl?: string;
  isVerified: boolean;
  skills: string[];
}

export const CERTIFICATIONS: Certification[] = [
  {
    id: 'cert-1',
    title: 'Belajar Dasar Google Cloud',
    issuer: 'Dicoding Indonesia',
    issueDate: 'Aug 2024',
    expiryDate: 'Aug 2027',
    credentialUrl: 'https://www.dicoding.com/certificates/QLZ97Y1VDP5D',
    isVerified: true,
    skills: ['Google Cloud Platform', 'Cloud Computing Basics', 'Infrastructure'],
  },
  {
    id: 'cert-2',
    title: 'Prompt Design in Vertex AI Skill Badge',
    issuer: 'Google Cloud Skills Boost',
    issueDate: 'Jun 2024',
    credentialUrl: 'https://www.credly.com/badges/02e10d68-0ae7-48cc-b8e9-73c5f47e4fd7/linked_in_profile',
    isVerified: true,
    skills: ['Vertex AI', 'Generative AI', 'Prompt Engineering', 'LLM Tuning'],
  },
  {
    id: 'cert-3',
    title: 'Introduction to Front-End Development',
    issuer: 'Coursera - Meta',
    issueDate: 'Feb 2024',
    credentialUrl: 'https://www.coursera.org/account/accomplishments/verify/7AEPP7EHWVKA',
    isVerified: true,
    skills: ['html','css','javascript','web development', 'responsive web design','front-end web development','react.js','web development tools','bootstrap (front-end framework)',],
  },
  {
    id: 'cert-4',
    title: 'Problem Solving (Basic)',
    issuer: 'HackerRank',
    issueDate: 'Oct 2023',
    credentialUrl: 'https://www.hackerrank.com/certificates/0531e1093f67',
    isVerified: true,
    skills: ['Data Structures','Algorithms','Problem Solving','Problem-Solving Skills',],
  },
  {
    id: 'cert-5',
    title: 'IT Specialist - HTML and CSS',
    issuer: 'Certiport',
    issueDate: 'Oct 2023',
    credentialUrl: 'https://www.credly.com/badges/167b1b38-01ba-433a-8ddf-c9446f314a80',
    isVerified: true,
    skills: ['html','css'],
  },
];
