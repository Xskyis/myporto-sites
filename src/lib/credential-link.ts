const CERTIFICATIONS_FALLBACK = 'https://www.linkedin.com/in/nabilfgrza/details/certifications/';

export function resolveCredentialLink(value?: string): string {
  const candidate = value?.trim();
  if (!candidate || /TODO/i.test(candidate)) return CERTIFICATIONS_FALLBACK;

  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' ? url.href : CERTIFICATIONS_FALLBACK;
  } catch {
    return CERTIFICATIONS_FALLBACK;
  }
}
