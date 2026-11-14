export function parse_sync_domains(value: string = ''): string[] {
  const domains = value.split('\n').map(domain => domain.trim().toLowerCase().replace(/^\.+|\.+$/g, ''));
  return [...new Set(domains.filter(domain => {
    if (!domain || /[\s/:*?#]/.test(domain)) return false;
    try {
      return new URL(`https://${domain}`).hostname === domain;
    } catch {
      return false;
    }
  }))];
}

export function matches_sync_domain(hostname: string, domains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}
