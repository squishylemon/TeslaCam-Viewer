#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadConfigEnv } from './load-config-env.mjs';

const env = loadConfigEnv();
const useHttps = env.USE_HTTPS === 'true' || env.USE_HTTPS === '1';
const entry = process.argv[2] || './dist/server/entry.mjs';

const childEnv = { ...process.env, ...env };
delete childEnv.SERVER_KEY_PATH;
delete childEnv.SERVER_CERT_PATH;

if (useHttps) {
  console.log('[start] USE_HTTPS=true — starting with TLS');
  const child = spawn(process.execPath, ['scripts/ensure-tls.mjs', entry], {
    stdio: 'inherit',
    env: childEnv,
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
} else {
  console.log('[start] USE_HTTPS=false — starting plain HTTP');
  const child = spawn(process.execPath, [entry], {
    stdio: 'inherit',
    env: {
      ...childEnv,
      HOST: childEnv.HOST || '0.0.0.0',
      PORT: childEnv.PORT || childEnv.WEB_PORT || '4321',
    },
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 1);
  });
}
