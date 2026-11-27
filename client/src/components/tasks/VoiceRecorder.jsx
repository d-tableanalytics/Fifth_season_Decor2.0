import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from 'lucide-react';

const MAX_SECONDS = 180;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Voice-note recorder: idle → recording → recorded. Max 180 s (auto stop).
 * value = recorded File | null; existingUrl = saved voice note (player + Remove).
 */
export function VoiceRecorder({ value, onChange, existingUrl, onRemoveExisting }) {
  const [state, setState] = useState(value ? 'recorded' : 'idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const rec = useRef(null);
  const timer = useRef(null);
  const stream = useRef(null);

  const cleanup = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => { cleanup(); if (rec.current?.state === 'recording') rec.current.stop(); }, []);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const start = async () => {
    setError('');
    if (!window.isSecureContext) {
      setError('The microphone works only on a secure (https://) address. Open the site over https, or upload an audio file as an attachment.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio. Upload an audio file as an attachment instead.');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone permission was refused. Allow the microphone in the browser settings and try again.');
      return;
    }
    const chunks = [];
    const mr = new MediaRecorder(stream.current);
    rec.current = mr;
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      cleanup();
      const type = mr.mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([new Blob(chunks, { type })], `voice-note.${ext}`, { type });
      setPreview(URL.createObjectURL(file));
      onChange(file);
      setState('recorded');
    };
    mr.start();
    setSecs(0);
    setState('recording');
    let s = 0;
    timer.current = setInterval(() => {
      s += 1;
      setSecs(s);
      if (s >= MAX_SECONDS && mr.state === 'recording') mr.stop();
    }, 1000);
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();
  const discard = () => { setPreview(null); onChange(null); setState('idle'); };

  return (
    <div className="tk-voice">
      {existingUrl && state !== 'recorded' && (
        <div className="tk-voice__row">
          <audio controls src={existingUrl} />
          <button type="button" className="tk-link tk-link--danger" onClick={onRemoveExisting}>Remove</button>
        </div>
      )}
      {state === 'idle' && (
        <button type="button" className="btn btn--secondary btn--sm" onClick={start}>
          <Mic size={15} /> {existingUrl ? 'Record a new voice note' : '🎙️ Record voice note'}
        </button>
      )}
      {state === 'recording' && (
        <div className="tk-voice__row">
          <span className="tk-voice__dot" /> <strong>{mmss(secs)}</strong> <span className="tk-muted">/ {mmss(MAX_SECONDS)}</span>
          <button type="button" className="btn btn--danger btn--sm" onClick={stop}><Square size={14} /> Stop</button>
        </div>
      )}
      {state === 'recorded' && (
        <div className="tk-voice__row">
          {preview && <audio controls src={preview} />}
          <button type="button" className="tk-link tk-link--danger" onClick={discard}><Trash2 size={13} /> Discard</button>
        </div>
      )}
      {error && <p className="tk-err">{error}</p>}
    </div>
  );
}
