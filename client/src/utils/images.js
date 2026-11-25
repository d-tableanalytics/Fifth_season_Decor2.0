/**
 * Google Drive "share" links (drive.google.com/file/d/<id>/view) are web pages, not images.
 * These helpers turn them into direct thumbnail URLs that work in <img>.
 * The Drive files must be shared as "Anyone with the link".
 */
const DRIVE_ID_PATTERNS = [
  /drive\.google\.com\/file\/d\/([\w-]{20,})/,
  /drive\.google\.com\/(?:open|uc|thumbnail)\?(?:.*&)?id=([\w-]{20,})/,
  /googleusercontent\.com\/d\/([\w-]{20,})/,
  /docs\.google\.com\/uc\?(?:.*&)?id=([\w-]{20,})/,
];

export function driveFileId(url) {
  if (!url) return null;
  for (const re of DRIVE_ID_PATTERNS) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Primary image source at roughly `width` px wide. Non-Drive URLs are returned as-is. */
export function imageSrc(url, width = 400) {
  const id = driveFileId(url);
  return id ? `https://lh3.googleusercontent.com/d/${id}=w${width}` : url || null;
}

/** Second source to try if the first fails (Drive's own thumbnail endpoint). */
export function imageFallbackSrc(url, width = 400) {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${width}` : null;
}

/** Link that opens the original file. */
export const imageOpenUrl = (url) => {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/view` : url;
};
