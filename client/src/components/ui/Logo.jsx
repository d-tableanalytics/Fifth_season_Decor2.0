export const BRAND_NAME = 'Fifth Seasons Decor';

/** Circular brand mark from /public/Assets/logo.webp (optimised copy of FSD_LOGO.png). */
export function Logo({ size = 96, className = '' }) {
  return (
    <img
      src="/Assets/logo.webp"
      alt={BRAND_NAME}
      width={size}
      height={size}
      className={`logo-mark ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
