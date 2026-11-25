import { useId, useRef, useState } from 'react';
import { UploadCloud, X, RefreshCw, Cloud, Link2 } from 'lucide-react';
import { ImageThumb } from './ImageThumb';
import { Spinner } from './Loader';
import { uploadsApi, MAX_IMAGE_BYTES, IMAGE_TYPES } from '../../api/uploads';
import { getErrorMessage } from '../../api/client';

const isS3 = (v) => typeof v === 'string' && v.startsWith('s3://');
const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

/**
 * Image picker: upload a file to AWS S3 (drag & drop or browse) OR paste an image link.
 * value      — the stored value: 's3://…' after upload, or an http(s) URL
 * previewUrl — a viewable URL for an S3 value (signed URL from the API)
 * onChange(value, previewUrl, meta)
 */
export function ImageUploadField({ value, previewUrl, onChange, onUploaded, s3Enabled, error, label = 'Image', alt, folder = 'inventory', compact = false, disabled = false }) {
  const id = useId();
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null); // null = idle, 0-100 = uploading
  const [uploadError, setUploadError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileMeta, setFileMeta] = useState(null);

  const uploading = progress !== null;
  const shownUrl = isS3(value) ? previewUrl : value?.trim();

  const pick = () => inputRef.current?.click();

  const handleFile = async (file) => {
    setUploadError(null);
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setUploadError('Only JPG, PNG, WebP or GIF images are allowed');
    if (file.size > MAX_IMAGE_BYTES) return setUploadError(`Image is ${mb(file.size)} — the limit is 10 MB`);

    setProgress(0);
    try {
      const res = await uploadsApi.image(folder, file, setProgress);
      setFileMeta({ name: res.name, size: res.size });
      onUploaded?.(res.url);
      onChange(res.url, res.viewUrl);
    } catch (err) {
      setUploadError(getErrorMessage(err));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!uploading && s3Enabled) handleFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className={`field upload-field ${error || uploadError ? 'field--error' : ''}`}>
      <span className="field__label">{label}</span>

      <div className="upload-field__row">
        <ImageThumb url={shownUrl} size={compact ? 64 : 88} width={300} alt={alt} />

        <div className="upload-field__main">
          {disabled && !shownUrl && <p className="field__hint">No image</p>}
          {disabled ? null : s3Enabled && (
            <div
              className={`dropzone ${dragOver ? 'is-over' : ''} ${uploading ? 'is-busy' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={inputRef}
                id={id}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                hidden
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {uploading ? (
                <div className="dropzone__progress">
                  <span className="dropzone__progress-label">
                    <Spinner size={14} /> Uploading to S3… {progress}%
                  </span>
                  <span className="progress">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                </div>
              ) : isS3(value) ? (
                <div className="upload-chip">
                  <Cloud size={16} />
                  <span className="upload-chip__text">
                    <strong>{fileMeta?.name || 'Uploaded image'}</strong>
                    <small>Stored on AWS S3{fileMeta ? ` · ${mb(fileMeta.size)}` : ''}</small>
                  </span>
                  <button type="button" className="icon-btn icon-btn--sm" title="Replace image" onClick={pick}>
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm icon-btn--danger"
                    title="Remove image"
                    onClick={() => {
                      setFileMeta(null);
                      onChange('', null);
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button type="button" className="dropzone__cta" onClick={pick}>
                  <UploadCloud size={20} />
                  <span>
                    <strong>Click to upload</strong> or drag &amp; drop
                    <small>JPG, PNG, WebP or GIF · max 10 MB · stored on AWS S3</small>
                  </span>
                </button>
              )}
            </div>
          )}

          {!disabled && !isS3(value) && !uploading && (
            <label className="url-input">
              <Link2 size={15} />
              <input
                type="url"
                value={value || ''}
                onChange={(e) => onChange(e.target.value, null)}
                placeholder={s3Enabled ? 'or paste an image link (Google Drive / web)' : 'Paste an image link (Google Drive / web)'}
                aria-label="Image URL"
              />
              {value && (
                <button type="button" className="url-input__clear" onClick={() => onChange('', null)} aria-label="Clear link">
                  <X size={14} />
                </button>
              )}
            </label>
          )}

          {uploadError || error ? (
            <p className="field__error">{uploadError || error}</p>
          ) : (
            !s3Enabled && <p className="field__hint">File upload is off — AWS S3 is not configured on the server.</p>
          )}
        </div>
      </div>
    </div>
  );
}
