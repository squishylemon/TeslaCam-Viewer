import fs from 'node:fs';
import path from 'node:path';

/** Read config.env from project root (no dotenv dependency). */
export function loadConfigEnv(root = process.cwd()) {
  const file = path.join(root, 'config.env');
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    env[key] = val;
  }
  return env;
}
