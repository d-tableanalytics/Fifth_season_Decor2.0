/**
 * Loader variants:
 *  - <Loader fullscreen label="..." />  : full page loader with thread-spool animation (app boot / route change)
 *  - <Loader />                         : inline spool loader for cards/sections
 *  - <Spinner />                        : small spinner for buttons
 */
export function Loader({ fullscreen = false, label = 'Loading…' }) {
  const content = (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader__spool">
        <span className="loader__thread" />
        <span className="loader__thread" />
        <span className="loader__thread" />
        <span className="loader__thread" />
      </div>
      <p className="loader__label">{label}</p>
    </div>
  );
  return fullscreen ? <div className="loader-screen">{content}</div> : content;
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Skeleton({ width = '100%', height = 14, radius = 6 }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} />;
}
