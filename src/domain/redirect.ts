/**
 * Post-login target from `?next=`: only a path on the cockpit itself.
 * Browsers read `/\evil.example` like `//evil.example`, so backslashes and
 * control characters are refused along with protocol-relative paths.
 */
export function safeNextPath(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next)) return "/";
  const base = "https://cockpit.invalid";
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
