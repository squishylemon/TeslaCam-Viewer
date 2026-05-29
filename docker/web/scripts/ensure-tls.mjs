#!/usr/bin/env node
/**
 * Generate a self-signed TLS cert if missing, then start the Astro Node server with HTTPS.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tlsDir = process.env.TLS_DIR?.trim() || '/app/data/tls';
const keyPath = path.join(tlsDir, 'key.pem');
const certPath = path.join(tlsDir, 'cert.pem');
const markerPath = path.join(tlsDir, 'cert-san.txt');

const siteHost = (process.env.SITE_HOSTNAME || 'teslacam.local').trim().toLowerCase();
const lanIp = process.env.LAN_IP?.trim() || '';

function buildSan() {
  const parts = ['DNS:localhost', `DNS:${siteHost}`, 'IP:127.0.0.1'];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lanIp)) {
    parts.push(`IP:${lanIp}`);
  }
  return parts.join(',');
}

function needsRegenerate() {
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) return true;
  const prev = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
  return prev !== buildSan();
}

function verifyOpenSsl() {
  try {
    execSync('openssl version', { stdio: 'ignore' });
  } catch {
    console.error('[tls] openssl not found in container');
    process.exit(1);
  }
}

fs.mkdirSync(tlsDir, { recursive: true });

if (needsRegenerate()) {
  verifyOpenSsl();
  const san = buildSan();
  console.log(`[tls] Generating certificate (SAN: ${san})`);
  try {
    fs.unlinkSync(keyPath);
    fs.unlinkSync(certPath);
  } catch {
    /* first run */
  }
  try {
    execSync(
      [
        'openssl req -x509',
        '-newkey rsa:2048',
        `-keyout "${keyPath}"`,
        `-out "${certPath}"`,
        '-days 825',
        '-nodes',
        `-subj "/CN=${siteHost}"`,
        `-addext "subjectAltName=${san}"`,
      ].join(' '),
      { stdio: 'inherit' },
    );
  } catch (err) {
    console.error('[tls] Certificate generation failed:', err?.message || err);
    process.exit(1);
  }
  fs.writeFileSync(markerPath, san, 'utf8');
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    /* Windows */
  }
}

if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('[tls] Missing key or certificate after generation');
  process.exit(1);
}

process.env.SERVER_KEY_PATH = keyPath;
process.env.SERVER_CERT_PATH = certPath;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('[tls] Usage: node scripts/ensure-tls.mjs <server-entry.js>');
  process.exit(1);
}

const port = process.env.PORT || process.env.WEB_PORT || '4321';
const host = process.env.HOST || '0.0.0.0';
console.log(`[tls] HTTPS listening will be on https://${host === '0.0.0.0' ? siteHost : host}:${port}`);
console.log(`[tls] Also works at https://${lanIp || siteHost}:${port} (accept the certificate warning)`);

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    HOST: host,
    PORT: String(port),
  },
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
