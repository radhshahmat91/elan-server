// Image storage. Cloudinary when it is configured, otherwise the local ./uploads folder (development only:
// most hosts wipe local disks on every deploy, so production should use Cloudinary).
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../config/env.js';
import { randomToken } from '../utils/crypto.js';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Pure. Identifies an image from its first bytes, never from the file name or the browser's claim.
 * SVG is deliberately not accepted: it can carry scripts.
 */
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (PNG.every((byte, i) => buffer[i] === byte)) return { mime: 'image/png', ext: 'png' };
  const tag = (from, to) => buffer.toString('latin1', from, to);
  if (tag(0, 4) === 'RIFF' && tag(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (tag(4, 8) === 'ftyp' && ['avif', 'avis'].includes(tag(8, 12))) return { mime: 'image/avif', ext: 'avif' };
  return null;
}

async function toCloudinary(buffer, folder) {
  const { v2: cloudinary } = await import('cloudinary');
  cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
  const result = await new Promise((resolvePromise, reject) => {
    cloudinary.uploader.upload_stream({ folder, resource_type: 'image', overwrite: false }, (err, out) => (err ? reject(err) : resolvePromise(out))).end(buffer);
  });
  return { url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height };
}

async function toDisk(buffer, ext) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomToken(6).replace(/[^a-zA-Z0-9]/g, 'x')}.${ext}`;
  await writeFile(resolve(UPLOAD_DIR, name), buffer, { flag: 'wx' });
  return { url: `/uploads/${name}`, publicId: undefined };
}

/** Stores a validated image and returns where the website can load it from. */
export async function storeImage(buffer, kind, { folder = 'elan' } = {}) {
  const stored = env.cloudinaryConfigured ? await toCloudinary(buffer, folder) : await toDisk(buffer, kind.ext);
  return { ...stored, mime: kind.mime, size: buffer.length, storage: env.cloudinaryConfigured ? 'cloudinary' : 'local' };
}
