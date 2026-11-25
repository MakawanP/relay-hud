const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const BLOCKED_METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "100.100.100.200",
  "[fd00:ec2::254]",
  "fd00:ec2::254",
]);

function isPrivateLanIpv4(hostname: string): boolean {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 127) return true;
  return false;
}

export function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(lower) || lower.endsWith(".localhost");
}

function isLinkLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    BLOCKED_METADATA_HOSTS.has(lower) ||
    lower.startsWith("169.254.") ||
    lower.startsWith("[fe80:") ||
    lower.startsWith("fe80:") ||
    lower === "0.0.0.0" ||
    lower === "[::]" ||
    lower === "::"
  );
}

/**
 * Validates an OpenAI-compatible provider base URL.
 * Allows https:// for remote APIs and http:// strictly for loopback or private LAN hosts (e.g. Ollama / LM Studio).
 */
export function validateProviderBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL must be a valid http(s) URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Base URL must not embed credentials.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || isLinkLocalHost(host)) {
    throw new Error("Base URL points to a blocked metadata or link-local address.");
  }

  if (parsed.protocol === "https:") {
    return parsed.toString().replace(/\/+$/, "");
  }

  if (
    parsed.protocol === "http:" &&
    (isLoopbackHostname(host) || isPrivateLanIpv4(host))
  ) {
    return parsed.toString().replace(/\/+$/, "");
  }

  throw new Error(
    "Remote provider Base URLs must use https:// (http:// is allowed only for localhost or private LAN servers like Ollama).",
  );
}

/**
 * Validates an OIDC Issuer URL. Requires https:// except for localhost dev issuers.
 */
export function validateOidcIssuerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("OIDC Issuer must be a valid URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("OIDC Issuer URL must not embed credentials.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || isLinkLocalHost(host)) {
    throw new Error("OIDC Issuer points to a blocked metadata address.");
  }

  if (parsed.protocol === "https:") {
    return parsed.toString().replace(/\/+$/, "");
  }
  if (parsed.protocol === "http:" && isLoopbackHostname(host)) {
    return parsed.toString().replace(/\/+$/, "");
  }

  throw new Error(
    "OIDC Issuer URL must use https:// (http:// allowed only for localhost).",
  );
}

export function validateDiscoveredOidcEndpoint(
  endpointUrl: string,
  allowLoopbackHttp: boolean,
): string {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new Error("OIDC discovery returned a malformed endpoint URL.");
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || isLinkLocalHost(host)) {
    throw new Error("OIDC discovery returned a blocked metadata address.");
  }
  if (parsed.protocol === "https:") return parsed.toString();
  if (
    allowLoopbackHttp &&
    parsed.protocol === "http:" &&
    isLoopbackHostname(host)
  ) {
    return parsed.toString();
  }
  throw new Error("OIDC discovered endpoints must use https://.");
}
