import { PROFILE } from './profile';

export interface SocialLink {
  name: string;
  url: string;
  label: string;
  icon: string;
}

export const SOCIALS: SocialLink[] = [
  {
    name: 'GitHub',
    url: 'https://github.com/Xskyis',
    label: 'github.com/Xskyis',
    icon: 'simple-icons:github',
  },
  {
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/in/nabilfgrza/',
    label: 'linkedin.com/in/nabilfgrza',
    icon: 'simple-icons:linkedin',
  },
  {
    name: 'Email',
    url: `mailto:${PROFILE.email}`,
    label: PROFILE.email,
    icon: 'lucide:mail',
  },
];
