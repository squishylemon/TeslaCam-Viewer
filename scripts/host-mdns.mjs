#!/usr/bin/env node
/**
 * Publish teslacam.local on the LAN (mDNS A record), like Home Assistant / Avahi.
 * bonjour-service alone only advertises a _http._tcp service, not the .local hostname
 * browsers need when you type http://teslacam.local:4321
 */
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
  console.error('[host-mdns] LAN_IP missing in config.env — run setup.ps1 first');
  process.exit(1);
}

const mdnsServer = mdns();

function aRecord() {
  return { name: fqdn, type: 'A', ttl: 120, data: lanIp };
}

function announce() {
  mdnsServer.respond({ answers: [aRecord()] });
}

mdnsServer.on('query', (query) => {
  const wants =
    query.questions?.some(
      (q) =>
        q.name === fqdn &&
        (q.type === 'A' || q.type === 'ANY' || q.type === 'PTR'),
    ) ?? false;
  if (wants) announce();
});

announce();
const announceTimer = setInterval(announce, 30_000);

const bonjour = new Bonjour();
bonjour.publish({
  name: shortName,
  type,
  port,
  txt: { path: '/', lan_ip: lanIp },
});

const proto = useHttps ? 'https' : 'http';
console.log(`[host-mdns] A record: ${fqdn} -> ${lanIp}`);
console.log(`[host-mdns] Service: _${type}._tcp port ${port}`);
console.log(`[host-mdns] Open: ${proto}://${fqdn}:${port}/`);
console.log('[host-mdns] Running (keep setup.ps1 host-mdns process alive)');

function shutdown() {
  clearInterval(announceTimer);
  bonjour.unpublishAll(() => bonjour.destroy());
  mdnsServer.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.resume();
