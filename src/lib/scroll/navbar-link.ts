/** Return a fragment only when following it is a same-document navigation. */
export function getSamePageHash(href: string, currentHref: string): string | null {
  try {
    const destination = new URL(href, currentHref);
    const current = new URL(currentHref);
    if (
      destination.origin !== current.origin ||
      destination.pathname !== current.pathname ||
      destination.search !== current.search ||
      !destination.hash
    ) {
      return null;
    }
    return destination.hash;
  } catch {
    return null;
  }
}
