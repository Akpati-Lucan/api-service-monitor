import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { validationError } from "../utils/errors.js";

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("10.0.0.0", 8, "ipv4");
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addSubnet("172.16.0.0", 12, "ipv4");
blocked.addSubnet("192.0.2.0", 24, "ipv4");
blocked.addSubnet("192.168.0.0", 16, "ipv4");
blocked.addSubnet("100.64.0.0", 10, "ipv4");
blocked.addSubnet("198.51.100.0", 24, "ipv4");
blocked.addSubnet("203.0.113.0", 24, "ipv4");
blocked.addSubnet("224.0.0.0", 4, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

const blockedNames = new Set(["localhost", "localhost.localdomain", "metadata", "metadata.google.internal"]);

export interface DestinationDeps {
  resolveHost?: (hostname: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
}

export function hostWithin(domain: string, hostname: string): boolean {
  const root = domain.trim().toLowerCase().replace(/\.$/, "");
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!root || root.includes("/") || root.includes(":") || root.includes(" ")) return false;
  return host === root || host.endsWith(`.${root}`);
}

export function isBlockedAddress(address: string): boolean {
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  const family = isIP(mapped);
  if (family === 4) return blocked.check(mapped, "ipv4");
  if (family === 6) return blocked.check(mapped, "ipv6") || blocked.check(address, "ipv6");
  return true;
}

export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw validationError("Destination must be a public http(s) URL", { url: ["invalid URL"] });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw validationError("Destination must be a public http(s) URL", { url: ["unsupported protocol"] });
  }
  if (url.username || url.password) {
    throw validationError("Destination must be a public http(s) URL", { url: ["credentials are not allowed"] });
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || blockedNames.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw validationError("Destination must be a public http(s) URL", { url: ["private or local destination"] });
  }
  if (isIP(hostname) && isBlockedAddress(hostname)) {
    throw validationError("Destination must be a public http(s) URL", { url: ["private or local destination"] });
  }
  return url;
}

export async function resolvePublicHost(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export async function assertPublicDestination(raw: string, deps: DestinationDeps = {}): Promise<string> {
  const url = parsePublicUrl(raw);
  const resolveHost = deps.resolveHost ?? resolvePublicHost;
  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw validationError("Destination must be a public http(s) URL", { url: ["destination could not be resolved"] });
  }
  if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address))) {
    throw validationError("Destination must be a public http(s) URL", { url: ["private or local destination"] });
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    throw validationError("Destination must be a public http(s) URL", { url: ["destination could not be verified"] });
  }
  await response.body?.cancel().catch(() => undefined);

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw validationError("Destination must be a public http(s) URL", { url: ["redirect has no destination"] });
    }
    const next = parsePublicUrl(new URL(location, url).toString());
    let nextAddresses: string[];
    try {
      nextAddresses = await resolveHost(next.hostname);
    } catch {
      throw validationError("Destination must be a public http(s) URL", { url: ["redirect could not be resolved"] });
    }
    if (nextAddresses.length === 0 || nextAddresses.some((address) => isBlockedAddress(address))) {
      throw validationError("Destination must be a public http(s) URL", { url: ["redirect ends on a private network"] });
    }
  }
  return url.toString();
}
