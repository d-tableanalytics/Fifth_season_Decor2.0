import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { CameraOff } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

const cameraError = (e) => {
  if (!window.isSecureContext) return 'The camera works only on a secure (https) address or on localhost.';
  switch (e?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Allow the camera for this site in the browser settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is being used by another app. Close it and try again.';
    default:
      return e?.message || 'Could not start the camera.';
  }
};

/**
 * Opens the device camera and reads a QR code or barcode (Code 128 / 39, EAN, UPC, ITF, Data Matrix …).
 * Calls onScan(text) once and closes; the back camera is preferred on phones.
 */
export function ScanCodeModal({ title = 'Scan code', hint, onScan, onClose }) {
  const viewRef = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(cameraError());
      setStarting(false);
      return undefined;
    }
    const reader = new BrowserMultiFormatReader();
    let controls = null;
    let done = false;
    // Each start gets its own <video>: stopping an older start (e.g. after switching camera) must not blank the new one
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('aria-label', 'Camera preview');
    viewRef.current?.prepend(video);
    setError('');
    setStarting(true);
    const constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } } };
    reader
      .decodeFromConstraints(constraints, video, (result, _err, ctl) => {
        if (result && !done) {
          done = true;
          ctl.stop();
          onScanRef.current(result.getText().trim());
        }
      })
      .then(async (c) => {
        controls = c;
        if (done) c.stop();
        setStarting(false);
        // Labels of cameras are only available after permission was given
        setDevices(await BrowserMultiFormatReader.listVideoInputDevices().catch(() => []));
      })
      .catch((e) => {
        if (done) return; // an older start that was already stopped
        setError(cameraError(e));
        setStarting(false);
      });
    return () => {
      done = true;
      controls?.stop();
      video.remove();
    };
  }, [deviceId]);

  return (
    <Modal open title={title} subtitle={hint} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}>
      {error ? (
        <div className="scan__error">
          <CameraOff size={22} />
          <p>{error}</p>
        </div>
      ) : (
        <div className="scan">
          <div className="scan__view" ref={viewRef}>
            <span className="scan__frame" aria-hidden="true" />
            {starting && <span className="scan__status">Starting camera…</span>}
          </div>
          {devices.length > 1 && (
            <label className="lbl-prop">
              Camera
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">Default (back camera)</option>
                {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
              </select>
            </label>
          )}
          <p className="cell-sub">Hold the QR code or barcode inside the frame — it is read automatically.</p>
        </div>
      )}
    </Modal>
  );
}
