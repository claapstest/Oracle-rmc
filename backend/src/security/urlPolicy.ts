/**
 * URL Policy — SSRF protection for outbound server configuration
 * Story ID: VYR-051
 * Epic: EPIC 6 — OWASP application and API security hardening
 * Branch Applicability: Both (standard-veyra-application-dev & veyra-application-dev)
 *
 * Governs which destinations the server is allowed to be pointed at:
 *   - validateAndNormalizeUrl(): used when an administrator saves the Oracle
 *     Fusion integration base URL. Enforces HTTPS, no path/query/fragment,
 *     and rejects private, loopback and cloud-metadata addresses so the
 *     server cannot be pointed at internal infrastructure (VYR-047 finding:
 *     outbound URLs must be restricted to approved destinations).
 *   - Request-time SSRF pinning lives in CommandCenterService
 *     (resolveAndValidateUrl): outbound requests must match the configured
 *     Oracle Fusion host exactly.
 */

// Hostnames/IPs that must never be accepted as an outbound integration base.
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,                          // IPv4 loopback
  /^10\./,                           // RFC1918
  /^0\./,                            // "this host" range
  /^192\.168\./,                     // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,      // RFC1918 172.16.0.0/12
  /^169\.254\./,                     // link-local incl. cloud metadata (169.254.169.254)
  /^::1$/,                           // IPv6 loopback
  /^\[?::ffff:127\./i,               // IPv4-mapped IPv6 loopback
  /^\[?::ffff:10\./i,
  /^\[?::ffff:192\.168\./i,
  /^\[?::ffff:169\.254\./i,
];

const PRIVATE_HOSTNAME_SUFFIXES = ['.internal', '.local', '.lan', '.corp', '.home'];

/**
 * True when a hostname is a public, routable address (not loopback, private,
 * link-local/metadata, or internal-suffixed).
 */
export function isPublicHttpsHost(hostname: string): boolean {
  const host = (hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) return false;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
  // Bare single-label hostnames (e.g. "myserver") resolve via search domains
  // and can land on internal infrastructure — require a dot.
  if (!host.includes('.')) return false;
  return true;
}

/**
 * Validates and normalizes an administrator-provided integration base URL.
 * Throws when the URL violates policy; returns `protocol//host` on success.
 */
export function validateAndNormalizeUrl(url: string): string {
  let trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Base URL is required.');
  }

  // Reject query parameters and fragments
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('Base URL must not contain query parameters (?) or fragments (#).');
  }

  // Require HTTPS
  if (!trimmed.startsWith('https://')) {
    if (trimmed.startsWith('http://')) {
      throw new Error('Secure connection (https://) is required.');
    } else {
      trimmed = 'https://' + trimmed;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error('Invalid URL format. Please enter a valid URL.');
  }

  // Reject pathname prefixes
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname.toLowerCase() !== '') {
    throw new Error("Please enter only the Base URL (e.g., https://example.oraclecloud.com) without any path (e.g., /hcmRestApi/...)");
  }

  // VYR-051: reject loopback, private, link-local/metadata and internal
  // hostnames — the server must only target approved public destinations.
  if (!isPublicHttpsHost(parsed.hostname)) {
    throw new Error(
      'Security Policy Rejection: the base URL must be a public Oracle Fusion host. ' +
      'Private, internal, loopback and metadata addresses are not permitted.'
    );
  }

  // Normalize URL (strips trailing slash automatically)
  return `${parsed.protocol}//${parsed.host}`;
}
