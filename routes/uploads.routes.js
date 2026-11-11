import { Router } from 'express';
import multer from 'multer';
import { requirePermission } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { badRequest } from '../utils/errors.js';
import { created } from '../utils/http.js';
import { audit } from '../services/auditService.js';
import { MAX_UPLOAD_BYTES, sniffImage, storeImage } from '../services/uploadService.js';

export const basePath = '/admin/uploads';
const router = Router();

// Memory storage: the file is checked before anything touches disk or a third party.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } });

router.post('/', requirePermission('uploads:create'), limiter({ windowMs: 10 * 60_000, limit: 40, message: 'Too many uploads. Please wait a few minutes.' }), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload.');
  const kind = sniffImage(req.file.buffer);
  if (!kind) throw badRequest('That file is not a JPEG, PNG, WebP or AVIF image.');
  const stored = await storeImage(req.file.buffer, kind, { folder: 'elan' });
  await audit(req, 'upload.image', { type: 'upload' }, `Uploaded an image (${Math.round(stored.size / 1024)} KB, ${stored.storage})`);
  created(res, stored);
});

export default router;
