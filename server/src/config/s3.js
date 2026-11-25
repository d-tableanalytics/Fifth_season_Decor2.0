import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const BUCKET = process.env.AWS_S3_BUCKET;
const ENDPOINT = process.env.AWS_S3_ENDPOINT; // optional: MinIO / R2 / local testing

/** Uploads are available only when a bucket + region are configured. */
export const s3Enabled = () => Boolean(BUCKET && process.env.AWS_REGION);

export const s3 = new S3Client({
  region: process.env.AWS_REGION,
  ...(ENDPOINT && { endpoint: ENDPOINT, forcePathStyle: true }),
});

/**
 * Files are stored in the DB as `s3://<key>` (bucket comes from config), so the bucket
 * can stay private — the API hands out short-lived signed URLs for viewing.
 */
export const S3_PREFIX = 's3://';
export const isS3Ref = (v) => typeof v === 'string' && v.startsWith(S3_PREFIX);
export const keyFromRef = (v) => (isS3Ref(v) ? v.slice(S3_PREFIX.length) : null);
export const refFromKey = (key) => `${S3_PREFIX}${key}`;

export const putObject = (key, body, contentType) =>
  s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'private, max-age=31536000, immutable',
    })
  );

export const getViewUrl = (key, expiresIn = 3600) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });

export const deleteObject = (key) => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

/** Best-effort delete of an `s3://` reference; never throws (used for cleanup). */
export async function deleteRefQuietly(ref) {
  const key = keyFromRef(ref);
  if (!key || !s3Enabled()) return;
  try {
    await deleteObject(key);
  } catch (err) {
    console.warn(`S3 cleanup failed for ${key}: ${err.message}`);
  }
}

/** For each given column holding an image, add `<column>_view` (signed URL for s3:// refs, else null). */
export async function signImageFields(rows, keys) {
  return Promise.all(
    rows.map(async (r) => {
      const out = { ...r };
      for (const k of keys) {
        out[`${k}_view`] = s3Enabled() && isS3Ref(r[k]) ? await getViewUrl(keyFromRef(r[k])).catch(() => null) : null;
      }
      return out;
    })
  );
}

/** Add `image_view_url` (signed, 1h) to rows whose image_url is an S3 reference. */
export async function withImageViewUrls(rows) {
  if (!s3Enabled()) return rows.map((r) => ({ ...r, image_view_url: null }));
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      image_view_url: isS3Ref(r.image_url) ? await getViewUrl(keyFromRef(r.image_url)).catch(() => null) : null,
    }))
  );
}
