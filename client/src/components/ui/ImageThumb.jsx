import { useEffect, useState } from 'react';
import { ImageOff, ImageIcon, ZoomIn } from 'lucide-react';
import { imageSrc, imageFallbackSrc } from '../../utils/images';

/**
 * Lazy image with shimmer while loading, Drive fallback, and a placeholder on failure.
 * size: number of CSS px (square) or 'fill' to fill the parent.
 */
export function ImageThumb({ url, alt = '', size = 44, width = 200, onClick, className = '' }) {
  const [srcIndex, setSrcIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const sources = [imageSrc(url, width), imageFallbackSrc(url, width)].filter(Boolean);
  const failed = !url || srcIndex >= sources.length;

  useEffect(() => {
    setSrcIndex(0);
    setLoaded(false);
  }, [url]);

  const style = size === 'fill' ? undefined : { width: size, height: size };
  const Tag = onClick && !failed ? 'button' : 'span';

  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      className={`thumb ${size === 'fill' ? 'thumb--fill' : ''} ${loaded ? 'is-loaded' : ''} ${failed ? 'is-empty' : ''} ${className}`}
      style={style}
      onClick={failed ? undefined : onClick}
      title={failed ? (url ? 'Image could not be loaded' : 'No image') : 'Click to preview'}
      aria-label={failed ? undefined : `Preview image of ${alt}`}
    >
      {failed ? (
        url ? <ImageOff size={16} /> : <ImageIcon size={16} />
      ) : (
        <>
          <img
            src={sources[srcIndex]}
            alt={alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              setSrcIndex((i) => i + 1);
            }}
          />
          {onClick && (
            <span className="thumb__zoom" aria-hidden="true">
              <ZoomIn size={14} />
            </span>
          )}
        </>
      )}
    </Tag>
  );
}
