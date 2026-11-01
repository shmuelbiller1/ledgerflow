import { errorMessage } from '../auth/requestUser';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

/** Resolves a hostname to every address it has (dns.lookup with all: true). Injectable for tests. */
export type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface SafeFetchOptions extends RequestInit {
  allowedHostnames?: string[];
  timeoutMs?: number;
  /** Tests only: replaces DNS. The answer is checked once and the connection is pinned to it. */
  resolver?: HostResolver;
}

/** The checked destination: the URL plus the one address the connection will be made to. */
export interface SafeTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

const systemResolver: HostResolver = hostname => dns.lookup(hostname, { all: true });

/**
 * Checks if an IPv4 address is in a private, loopback, link-local, or reserved range.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(p => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // Invalid IP is treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 – 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (Link-local / Cloud Metadata Server 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 198.18.0.0/15 (Network Benchmark Tests)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future Use)
  if (a >= 240) return true;

  // 255.255.255.255 (Broadcast)
  if (ip === '255.255.255.255') return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private, loopback, link-local, or IPv4-mapped private range.
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // Unspecified ::
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // Unique Local Address (fc00::/7 -> fc.. or fd..)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local unicast (fe80::/10)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) return true;

  // IPv4-mapped IPv6 (::ffff:192.0.2.128 or ::ffff:c000:0280)
  const v4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    return isPrivateOrReservedIPv4(v4MappedMatch[1]);
  }

  return false;
}

/**
 * Validates a target URL, resolves its host once and checks every address it resolves to.
 * Returns the address the connection must use (AUD-11: the checked address is the one connected to).
 * Throws if the URL resolves to an internal/private/loopback/cloud metadata IP.
 */
export async function resolveSafeTarget(
  urlString: string,
  allowedHostnames?: string[],
  resolver: HostResolver = systemResolver,
): Promise<SafeTarget> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (err) {
    throw new Error(`Invalid URL: ${urlString}`, { cause: err });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Forbidden protocol: ${url.protocol}. Only http: and https: are permitted.`);
  }

  const hostname = url.hostname.toLowerCase();

  // Check against optional allowlist
  if (allowedHostnames && allowedHostnames.length > 0) {
    const isAllowed = allowedHostnames.some(allowed =>
      hostname === allowed.toLowerCase() || hostname.endsWith(`.${allowed.toLowerCase()}`)
    );
    if (!isAllowed) {
      throw new Error(`Hostname '${hostname}' is not in the allowed destinations list.`);
    }
  }

  // Quick check for literal localhost / metadata hostnames
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
    throw new Error(`SSRF Prevention: Access to localhost or metadata services is strictly forbidden.`);
  }

  // Check if hostname is an IP literal (URL keeps IPv6 literals in brackets)
  const literal = hostname.replace(/^\[|\]$/g, '');
  const isIP = net.isIP(literal);
  if (isIP === 4) {
    if (isPrivateOrReservedIPv4(literal)) {
      throw new Error(`SSRF Prevention: Access to private/reserved IP (${literal}) is strictly forbidden.`);
    }
    return { url, address: literal, family: 4 };
  } else if (isIP === 6) {
    if (isPrivateOrReservedIPv6(literal)) {
      throw new Error(`SSRF Prevention: Access to private/reserved IPv6 (${literal}) is strictly forbidden.`);
    }
    return { url, address: literal, family: 6 };
  }

  // Resolve DNS once and verify all underlying IP addresses
  let pinned: SafeTarget | null = null;
  try {
    const lookupResults = await resolver(hostname);
    if (!lookupResults || lookupResults.length === 0) {
      throw new Error(`Unable to resolve host: ${hostname}`);
    }

    for (const record of lookupResults) {
      if (record.family === 4) {
        if (isPrivateOrReservedIPv4(record.address)) {
          throw new Error(`SSRF Prevention: Host ${hostname} resolves to forbidden IP ${record.address}.`);
        }
      } else if (record.family === 6) {
        if (isPrivateOrReservedIPv6(record.address)) {
          throw new Error(`SSRF Prevention: Host ${hostname} resolves to forbidden IPv6 ${record.address}.`);
        }
      } else {
        throw new Error(`SSRF Prevention: Host ${hostname} resolves to an unrecognised address ${record.address}.`);
      }
      pinned ??= { url, address: record.address, family: record.family === 6 ? 6 : 4 };
    }
  } catch (err) {
    if (errorMessage(err).includes('SSRF Prevention')) {
      throw err;
    }
    throw new Error(`DNS resolution failed for host ${hostname}: ${errorMessage(err)}`, { cause: err });
  }

  return pinned!;
}

/**
 * Validates a target URL and checks DNS resolution to prevent SSRF attacks.
 * Throws an Error if the URL resolves to an internal/private/loopback/cloud metadata IP.
 */
export async function validateSafeUrl(urlString: string, allowedHostnames?: string[], resolver?: HostResolver): Promise<URL> {
  return (await resolveSafeTarget(urlString, allowedHostnames, resolver)).url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void;

/**
 * A socket `lookup` that never asks DNS again: it answers with the address that was checked,
 * and only for the hostname that was checked.
 */
export function pinnedLookup(target: SafeTarget) {
  const expected = target.url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback): void => {
    if (hostname.toLowerCase() !== expected) {
      callback(Object.assign(new Error(`SSRF Prevention: unexpected lookup for ${hostname}.`), { code: 'ENOTFOUND' }), '');
      return;
    }
    if (typeof options === 'object' && options?.all) callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
}

/** Options for http(s).request: the original hostname (Host header, TLS SNI and certificate check) on the pinned address. */
export function pinnedRequestOptions(target: SafeTarget, method: string, headers: Record<string, string>): https.RequestOptions {
  const { url } = target;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return {
    protocol: url.protocol,
    hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    method,
    headers,
    lookup: pinnedLookup(target) as unknown as net.LookupFunction,
    agent: false,
    ...(url.protocol === 'https:' && !net.isIP(hostname) ? { servername: hostname } : {}),
  };
}

function requestBody(body: RequestInit['body']): Buffer | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new Error('safeFetch: unsupported request body type (use a string, URLSearchParams or bytes).');
}

function decoded(res: http.IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (encoding === 'deflate') return res.pipe(zlib.createInflate());
  if (encoding === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/** Sends the request to the pinned address. Does not validate: call resolveSafeTarget first. */
export function requestPinned(target: SafeTarget, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
  headers['accept-encoding'] ??= 'gzip, deflate, br';
  const payload = requestBody(init.body);
  if (payload) headers['content-length'] = String(payload.length);
  const method = (init.method || 'GET').toUpperCase();
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(pinnedRequestOptions(target, method, headers), res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        reject(new Error(`safeFetch: redirect to ${res.headers.location} refused (redirects are not followed).`));
        return;
      }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined || key === 'content-encoding' || key === 'content-length') continue;
        for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(key, v);
      }
      const noBody = method === 'HEAD' || status === 204 || status === 304;
      if (noBody) res.resume();
      const stream = noBody ? null : Readable.toWeb(decoded(res)) as ReadableStream<Uint8Array>;
      try {
        resolve(new Response(stream, { status, statusText: res.statusMessage, headers: responseHeaders }));
      } catch (err) {
        reject(err);
      }
    });
    const onAbort = () => req.destroy(new Error(`safeFetch: request to ${target.url.host} timed out.`));
    if (signal?.aborted) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', reject);
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.end(payload);
  });
}

/**
 * SSRF-Safe HTTP Fetch wrapper.
 * Rejects access to internal metadata, loopback and private networks, connects to the exact
 * address that was checked (no second DNS lookup) and refuses redirects.
 */
export async function safeFetch(inputUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { allowedHostnames, timeoutMs = 10000, resolver, ...fetchOptions } = options;

  const target = await resolveSafeTarget(inputUrl, allowedHostnames, resolver);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestPinned(target, fetchOptions, controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
