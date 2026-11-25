import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, ExternalLink, ImageOff } from 'lucide-react';
import { imageSrc, imageFallbackSrc, imageOpenUrl } from '../../utils/images';
import { Spinner } from './Loader';

/**
 * Full-screen image preview.
 * items: [{ url, title, subtitle, details: [[label, value], ...] }], index: starting item.
 * ← / → navigate, Esc closes.
 */
export function Lightbox({ items, index, onIndex, onClose }) {
  const item = items[index];
  const [srcIndex, setSrcIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    setSrcIndex(0);
    setLoaded(false);
  }, [index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onIndex(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onIndex(index + 1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [index, hasPrev, hasNext, onIndex, onClose]);

  // Preload neighbours for snappy navigation
  useEffect(() => {
    [items[index - 1], items[index + 1]].forEach((it) => {
      if (it?.url) new Image().src = imageSrc(it.url, 1600);
    });
  }, [index, items]);

  if (!item) return null;
  const sources = [imageSrc(item.url, 1600), imageFallbackSrc(item.url, 1600)].filter(Boolean);
  const failed = srcIndex >= sources.length;

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Image preview: ${item.title}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="lightbox__top">
        <span className="lightbox__count">
          {index + 1} / {items.length}
        </span>
        <div className="lightbox__top-actions">
          <a className="lightbox__btn" href={imageOpenUrl(item.url)} target="_blank" rel="noreferrer noopener" title="Open original">
            <ExternalLink size={17} />
          </a>
          <button className="lightbox__btn" onClick={onClose} aria-label="Close preview">
            <X size={19} />
          </button>
        </div>
      </div>

      <div className="lightbox__stage" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {hasPrev && (
          <button className="lightbox__nav lightbox__nav--prev" onClick={() => onIndex(index - 1)} aria-label="Previous image">
            <ChevronLeft size={26} />
          </button>
        )}

        {failed ? (
          <div className="lightbox__error">
            <ImageOff size={36} />
            <p>Image could not be loaded.</p>
            <a href={imageOpenUrl(item.url)} target="_blank" rel="noreferrer noopener">
              Open in Google Drive
            </a>
          </div>
        ) : (
          <>
            {!loaded && (
              <span className="lightbox__spinner">
                <Spinner size={30} />
              </span>
            )}
            <img
              key={sources[srcIndex]}
              className={`lightbox__img ${loaded ? 'is-loaded' : ''}`}
              src={sources[srcIndex]}
              alt={item.title}
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => setSrcIndex((i) => i + 1)}
            />
          </>
        )}

        {hasNext && (
          <button className="lightbox__nav lightbox__nav--next" onClick={() => onIndex(index + 1)} aria-label="Next image">
            <ChevronRight size={26} />
          </button>
        )}
      </div>

      <div className="lightbox__info">
        <div>
          <p className="lightbox__title">{item.title}</p>
          {item.subtitle && <p className="lightbox__sub">{item.subtitle}</p>}
        </div>
        {item.details?.length > 0 && (
          <dl className="lightbox__details">
            {item.details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>,
    document.body
  );
}
