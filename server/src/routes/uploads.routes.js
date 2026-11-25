import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { can } from '../services/access.js';
import { query } from '../config/db.js';
import { s3Enabled, putObject, getViewUrl, refFromKey, keyFromRef, deleteObject } from '../config/s3.js';
import { HttpError, badRequest, forbidden } from '../utils/httpError.js';

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Upload folders: which permission module guards them, and where their refs live
 * (used to refuse discarding an image that is still in use).
 */
const FOLDERS = {
  inventory: { module: 'inventory', refs: [['inventory_stock', 'image_url']] },
  clients: {
    module: 'client_master',
    refs: [
      ['clients', 'vcard_front_url'], ['clients', 'vcard_back_url'], ['clients', 'showroom_front_url'], ['clients', 'showroom_back_url'],
      ['client_referrals', 'photo_reference'], ['client_top_selling_products', 'photo_reference'],
    ],
  },
  transports: { module: 'transport_master', refs: [['transports', 'transport_vcard_photo']] },
  delivery: { module: 'dispatch_pending', refs: [['dispatch_entries', 'proof_url']] }, // delivery proof photos
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

/** Detect the real image type from the file's first bytes (don't trust the client's mimetype). */
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return { type: 'image/gif', ext: 'gif' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

/** Resolve :folder and check the user can create or edit in that module. */
const folderGuard = (req, res, next) => {
  const name = req.uploadFolder || req.params.folder;
  const folder = Object.hasOwn(FOLDERS, name) ? FOLDERS[name] : null;
  if (!folder) return next(badRequest('Unknown upload folder'));
  if (!['create', 'edit'].some((a) => can(req.user, folder.module, a))) return next(forbidden());
  if (!s3Enabled()) return next(new HttpError(503, 'File storage is not configured. Add AWS S3 settings to the server .env.'));
  req.folder = { name, ...folder };
  next();
};

/** Is this s3:// ref still used by any record? */
async function inUse(folder, ref) {
  for (const [table, col] of folder.refs) {
    const { rowCount } = await query(`SELECT 1 FROM ${table} WHERE ${col} = $1 LIMIT 1`, [ref]);
    if (rowCount) return true;
  }
  return false;
}

const router = Router();
router.use(requireAuth);

const handleUpload = (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err?.code === 'LIMIT_FILE_SIZE') throw badRequest('Image must be 10 MB or smaller');
      if (err) throw badRequest(err.message);
      if (!req.file) throw badRequest('Choose an image to upload');
      const kind = sniffImage(req.file.buffer);
      if (!kind) throw badRequest('Only JPG, PNG, WebP or GIF images are allowed');

      const d = new Date();
      const key = `${req.folder.name}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${kind.ext}`;
      try {
        await putObject(key, req.file.buffer, kind.type);
      } catch (e) {
        console.error('S3 upload failed:', e.name, e.message);
        throw new HttpError(502, 'Could not upload to S3. Check the AWS credentials, region and bucket name.');
      }
      res.status(201).json({
        data: { url: refFromKey(key), viewUrl: await getViewUrl(key), name: req.file.originalname, size: req.file.size, type: kind.type },
      });
    } catch (e) {
      next(e);
    }
  });
};

const handleDiscard = async (req, res) => {
  const ref = req.body?.url;
  const key = keyFromRef(ref);
  if (!key || !key.startsWith(`${req.folder.name}/`)) throw badRequest('Invalid image reference');
  if (await inUse(req.folder, ref)) throw badRequest('This image is in use and cannot be discarded');
  await deleteObject(key);
  res.json({ message: 'Image discarded' });
};

// POST /api/uploads/:folder/image   (folder = inventory | clients | transports)
router.post('/:folder/image', folderGuard, handleUpload);
router.delete('/:folder/image', folderGuard, handleDiscard);

// Backwards-compatible inventory routes
const asInventory = (req, res, next) => ((req.uploadFolder = 'inventory'), next());
router.post('/inventory-image', asInventory, folderGuard, handleUpload);
router.delete('/inventory-image', asInventory, folderGuard, handleDiscard);

export default router;
