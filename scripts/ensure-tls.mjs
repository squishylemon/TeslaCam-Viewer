#!/usr/bin/env node
/**
 * Generate a self-signed TLS cert if missing, then start the Astro Node server with HTTPS.
 * Includes LAN_IP in the certificate so https://192.168.x.x:4321 works without a name mismatch.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const tlsDir = process.env.TLS_DIR?.trim() || '/app/data/tls';
const keyPath = path.join(tlsDir, 'key.pem');
const certPath = path.join(tlsDir, 'cert.pem');
const markerPath = path.join(tlsDir, 'cert-lan-ip.txt');

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
  return prev !== lanIp;
}

fs.mkdirSync(tlsDir, { recursive: true });

if (needsRegenerate()) {
  console.log(`[tls] Generating certificate (SAN: ${buildSan()})…`);
  try {
    fs.unlinkSync(keyPath);
    fs.unlinkSync(certPath);
  } catch {
    /* first run */
  }
  execSync(
    [
      'openssl req -x509',
      '-newkey rsa:2048',
      `-keyout "${keyPath}"`,
      `-out "${certPath}"`,
      '-days 825',
      '-nodes',
      `-subj "/CN=${siteHost}"`,
      `-addext "subjectAltName=${buildSan()}"`,
    ].join(' '),
    { stdio: 'inherit' },
  );
  fs.writeFileSync(markerPath, lanIp, 'utf8');
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    /* Windows */
  }
}

process.env.SERVER_KEY_PATH = keyPath;
process.env.SERVER_CERT_PATH = certPath;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('[tls] Usage: node scripts/ensure-tls.mjs <server-entry.js>');
  process.exit(1);
}

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
