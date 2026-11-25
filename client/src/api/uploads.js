import api from './client';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const featuresApi = {
  get: () => api.get('/meta/features').then((r) => r.data),
};

/** folder: 'inventory' | 'clients' | 'transports' */
export const uploadsApi = {
  /** Uploads to AWS S3 via the API. Resolves { url: 's3://…', viewUrl, name, size, type }. */
  image: (folder, file, onProgress) => {
    const body = new FormData();
    body.append('file', file);
    return api
      .post(`/uploads/${folder}/image`, body, {
        timeout: 120_000,
        onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
      })
      .then((r) => r.data.data);
  },
  /** Remove an uploaded image that was never saved. Best effort. */
  discard: (folder, url) => api.delete(`/uploads/${folder}/image`, { data: { url } }).catch(() => {}),

  // Inventory shortcuts (kept for existing callers)
  inventoryImage: (file, onProgress) => uploadsApi.image('inventory', file, onProgress),
  discardInventoryImage: (url) => uploadsApi.discard('inventory', url),
};
