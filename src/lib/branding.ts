import fs from 'node:fs';
import path from 'node:path';

const LOGO_BASENAME = 'custom-logo';
const META_FILE = 'logo-meta.json';
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

export interface LogoMeta {
  filename: string;
  mime: string;
  updatedAt: string;
}

export function brandingDir(): string {
  const env = process.env.BRANDING_DIR?.trim();
  return env ? path.resolve(env) : path.resolve(process.cwd(), 'data', 'branding');
}

function metaPath(): string {
  return path.join(brandingDir(), META_FILE);
}

function logoPath(): string | null {
  const meta = readLogoMeta();
  if (!meta) return null;
  const file = path.join(brandingDir(), meta.filename);
  return fs.existsSync(file) ? file : null;
}

export function ensureBrandingDir(): void {
  fs.mkdirSync(brandingDir(), { recursive: true });
}

export function readLogoMeta(): LogoMeta | null {
  try {
    const raw = fs.readFileSync(metaPath(), 'utf8');
    return JSON.parse(raw) as LogoMeta;
  } catch {
    return null;
  }
}

export function hasCustomLogo(): boolean {
  return logoPath() !== null;
}

export function logoPublicUrl(): string | null {
  const meta = readLogoMeta();
  if (!meta || !logoPath()) return null;
  return `/api/site/logo?v=${encodeURIComponent(meta.updatedAt)}`;
}

export function readLogoFile(): { filePath: string; mime: string } | null {
  const meta = readLogoMeta();
  const filePath = logoPath();
  if (!meta || !filePath) return null;
  return { filePath, mime: meta.mime };
}

function extForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/svg+xml':
      return '.svg';
    default:
      return '.bin';
  }
}

export function validateLogoUpload(mime: string, size: number): string | null {
  if (!ALLOWED_MIME.has(mime)) {
    return 'Use PNG, JPEG, WebP, or SVG.';
  }
  if (size <= 0) return 'File is empty.';
  return null;
}

export function saveLogo(buffer: Buffer, mime: string): LogoMeta {
  ensureBrandingDir();
  const dir = brandingDir();

  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(LOGO_BASENAME)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }

  const filename = `${LOGO_BASENAME}${extForMime(mime)}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);

  const meta: LogoMeta = {
    filename,
    mime,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(metaPath(), JSON.stringify(meta));
  return meta;
}

export function removeLogo(): void {
  const file = logoPath();
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.unlinkSync(metaPath());
  } catch {
    /* ignore */
  }
}
