#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { loadConfigEnv } from './load-config-env.mjs';

const env = loadConfigEnv();
const useHttps = env.USE_HTTPS === 'true' || env.USE_HTTPS === '1';
const entry = process.argv[2] || './dist/server/entry.mjs';

const child = useHttps
  ? spawn(process.execPath, ['scripts/ensure-tls.mjs', entry], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
  : spawn(process.execPath, [entry], {
      stdio: 'inherit',
      env: { ...process.env, ...env, HOST: env.HOST || '0.0.0.0', PORT: env.PORT || env.WEB_PORT || '4321' },
    });

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
