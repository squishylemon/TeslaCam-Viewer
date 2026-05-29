#!/usr/bin/env node
/**
 * Publish SITE_HOSTNAME (default teslacam.local) on the LAN via mDNS A record.
 */
import os from 'node:os';
import mdns from 'multicast-dns';
import { Bonjour } from 'bonjour-service';
import { loadConfigEnv } from './load-config-env.mjs';

const env = loadConfigEnv();
const fqdn = (env.SITE_HOSTNAME || 'teslacam.local').trim().toLowerCase();
const shortName = fqdn.replace(/\.local$/i, '') || 'teslacam';
const port = Number(env.WEB_PORT || env.PORT || 4321);
const useHttps = env.USE_HTTPS === 'true' || env.USE_HTTPS === '1';
const type = useHttps ? 'https' : 'http';
const lanIp = env.LAN_IP?.trim() || '';

if (!lanIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(lanIp)) {
  console.error('[host-mdns] LAN_IP missing in config.env');
  process.exit(1);
}

function resolveMdnsInterface() {
  const configured = env.MDNS_INTERFACE?.trim();
  if (configured) return configured;

  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && addr.address === lanIp) {
        return addr.address;
      }
    }
  }
  return lanIp;
}

const mdnsInterface = resolveMdnsInterface();
const mdnsServer = mdns({ interface: mdnsInterface });

function aRecord() {
  return { name: fqdn, type: 'A', ttl: 120, data: lanIp };
}

function wantsOurName(query) {
  return (
    query.questions?.some((q) => {
      const name = (q.name || '').toLowerCase();
      if (name !== fqdn && name !== `${shortName}.local`) return false;
      return q.type === 'A' || q.type === 'AAAA' || q.type === 'ANY' || q.type === 'PTR';
    }) ?? false
  );
}

function announce() {
  mdnsServer.respond({ answers: [aRecord()] }, () => {});
}

mdnsServer.on('error', (err) => {
  console.error(`[host-mdns] socket error on interface ${mdnsInterface}: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error('[host-mdns] Port 5353 is already in use (Avahi or systemd-resolved).');
    console.error('[host-mdns] On Linux run: ./scripts/linux-host-mdns.sh start');
    console.error('[host-mdns] Or set MDNS_MODE=host in config.env and restart setup.');
  }
});

mdnsServer.on('query', (query) => {
  if (wantsOurName(query)) announce();
});

for (let i = 0; i < 5; i += 1) {
  setTimeout(announce, i * 1000);
}
const announceTimer = setInterval(announce, 30_000);

const bonjour = new Bonjour();
bonjour.publish({
  name: shortName,
  type,
  port,
  txt: { path: '/', lan_ip: lanIp },
});

const proto = useHttps ? 'https' : 'http';
console.log(`[host-mdns] Interface: ${mdnsInterface}`);
console.log(`[host-mdns] A record: ${fqdn} -> ${lanIp}`);
console.log(`[host-mdns] Service: _${type}._tcp port ${port}`);
console.log(`[host-mdns] Open: ${proto}://${fqdn}:${port}/`);

function shutdown() {
  clearInterval(announceTimer);
  bonjour.unpublishAll(() => bonjour.destroy());
  mdnsServer.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.resume();
