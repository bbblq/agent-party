import { existsSync } from 'node:fs';
import type http from 'node:http';
import { networkInterfaces } from 'node:os';

export interface StudioEndpointsInfo {
  baseUrl: string;
  requestUrl: string;
  lanUrl: string | null;
  lanUrls: string[];
  dockerInternalUrl: string | null;
  listenPort: number;
}

const VIRTUAL_IFACE_RE =
  /^(docker\d*|br-|veth|cni\d*|flannel|cali|virbr|kube|tunl|wg\d*|tailscale|utun|wsl|loopback|lo)/i;

function isPrivate192(ip: string): boolean {
  return ip.startsWith('192.168.');
}

function isPrivate10(ip: string): boolean {
  return ip.startsWith('10.');
}

function isPrivate172(ip: string): boolean {
  const m = /^172\.(\d+)\./.exec(ip);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 16 && second <= 31;
}

function extractHost(urlStr: string): string {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return '';
  }
}

function normalizeOriginInput(raw: string, listenPort: number): string | null {
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return null;
  try {
    const withProto = /^https?:\/\//i.test(s) ? s : `http://${s}`;
    const u = new URL(withProto);
    if (!u.port && u.protocol === 'http:' && listenPort !== 80) {
      u.port = String(listenPort);
    }
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve accessible MCP endpoints for browser studio sessions, prioritizing real
 * LAN IPv4 addresses (`192.168.x.x` -> `10.x.x.x`) over Docker bridge interfaces
 * (`172.17-31.x.x`), while preserving the actual HTTP request host.
 */
export function resolveStudioEndpoints(opts: {
  req: http.IncomingMessage;
  listenPort: number;
  publicBaseUrl: string;
  ifaces?: ReturnType<typeof networkInterfaces>;
  env?: NodeJS.ProcessEnv;
  inDocker?: boolean;
}): StudioEndpointsInfo {
  const { req, listenPort, publicBaseUrl } = opts;
  const env = opts.env ?? process.env;
  const inDocker =
    opts.inDocker ?? (existsSync('/.dockerenv') || existsSync('/run/.containerenv'));

  const protoHeader =
    typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim()
      : '';
  const proto = protoHeader || 'http';
  const fwdHost =
    typeof req.headers['x-forwarded-host'] === 'string'
      ? req.headers['x-forwarded-host'].split(',')[0].trim()
      : '';
  const reqHost = fwdHost || req.headers.host || `127.0.0.1:${listenPort}`;
  const requestUrl = `${proto}://${reqHost}`.replace(/\/+$/, '');

  const prioEnv: string[] = [];
  const prio192: string[] = [];
  const prio10: string[] = [];
  const prio172: string[] = [];
  let dockerInternalUrl: string | null = null;

  for (const key of ['LAN_URL', 'HOST_IP', 'LAN_IP'] as const) {
    const val = env[key];
    if (!val) continue;
    const norm = normalizeOriginInput(val, listenPort);
    if (norm) prioEnv.push(norm);
  }

  for (const headerUrl of [requestUrl, req.headers.origin, req.headers.referer]) {
    if (typeof headerUrl !== 'string' || !headerUrl) continue;
    const norm = normalizeOriginInput(headerUrl, listenPort);
    if (!norm) continue;
    const host = extractHost(norm);
    if (isPrivate192(host)) prio192.push(norm);
    else if (isPrivate10(host)) prio10.push(norm);
  }

  let nets: ReturnType<typeof networkInterfaces> = {};
  try {
    nets = opts.ifaces ?? networkInterfaces();
  } catch {
    nets = {};
  }

  for (const [ifName, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    const isVirtualIf = VIRTUAL_IFACE_RE.test(ifName);
    for (const net of addrs) {
      if (net.family !== 'IPv4' || net.internal || !net.address) continue;
      const candidate = `http://${net.address}:${listenPort}`;
      if (isVirtualIf) {
        if (isPrivate172(net.address) && !dockerInternalUrl) dockerInternalUrl = candidate;
        continue;
      }
      if (isPrivate192(net.address)) {
        prio192.push(candidate);
      } else if (isPrivate10(net.address)) {
        prio10.push(candidate);
      } else if (isPrivate172(net.address)) {
        if (inDocker) {
          if (!dockerInternalUrl) dockerInternalUrl = candidate;
        } else {
          prio172.push(candidate);
        }
      }
    }
  }

  const seen = new Set<string>();
  const lanUrls: string[] = [];
  for (const candidate of [...prioEnv, ...prio192, ...prio10, ...prio172]) {
    const clean = candidate.replace(/\/+$/, '');
    if (!seen.has(clean)) {
      seen.add(clean);
      lanUrls.push(clean);
    }
  }

  return {
    baseUrl: publicBaseUrl.replace(/\/+$/, ''),
    requestUrl,
    lanUrl: lanUrls[0] ?? null,
    lanUrls,
    dockerInternalUrl,
    listenPort,
  };
}
