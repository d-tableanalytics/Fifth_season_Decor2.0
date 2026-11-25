import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, FileSpreadsheet, ExternalLink } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Loader';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const n = (v) => (v ?? 0).toLocaleString('en-IN');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Generic "Sync with Google Sheet" dialog for master data.
 * tabs:    [{ key, label, tabName, description }]  (one or more; checkboxes when > 1)
 * columns: { [tabKey]: [{ key, label, tone? ('success'|'info'|'warning'), hint? }] } — result columns per tab
 * run(tabKeys) -> { durationMs, results: [{ key, tab, sheetRows, ... }] }
 */
export function MasterSyncModal({ open, title, sheetUrl, tabs, columns, notes, run, loadLogs, onClose, onSynced }) {
  const toast = useToast();
  const [selected, setSelected] = useState(tabs.map((t) => t.key));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    loadLogs().then(setLogs).catch(() => setLogs([]));
  }, [open, loadLogs]);

  const start = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await run(selected);
      setResult(data);
      toast.success('Google Sheet synced', `Finished in ${(data.durationMs / 1000).toFixed(1)}s`);
      onSynced();
    } catch (err) {
      setError(getErrorMessage(err));
      toast.error('Sync failed', getErrorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  const footer = result ? (
    <>
      <Button variant="secondary" onClick={() => setResult(null)}>
        Sync again
      </Button>
      <Button onClick={onClose}>Done</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={running}>
        Cancel
      </Button>
      <Button icon={RefreshCw} onClick={start} loading={running} disabled={!selected.length}>
        {running ? 'Syncing…' : 'Start Sync'}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} busy={running} size="lg" title={title} subtitle="Pull the latest data directly from the shared Google Sheet" footer={footer}>
      {running ? (
        <div className="sync-running">
          <Spinner size={30} />
          <p className="sync-running__title">Reading Google Sheet…</p>
          <p className="sync-running__sub">This usually takes a few seconds. Please keep this window open.</p>
        </div>
      ) : result ? (
        <div className="sync-result">
          <div className="sync-result__banner">
            <CheckCircle2 size={22} />
            <div>
              <strong>Sync completed in {(result.durationMs / 1000).toFixed(1)}s</strong>
              <p>All changes were saved together.</p>
            </div>
          </div>
          {result.results.map((r) => (
            <div key={r.key} className="sync-tabresult">
              <p className="form-section">
                {tabs.find((t) => t.key === r.key)?.label} <small>· tab “{r.tab}” · {n(r.sheetRows)} sheet rows</small>
              </p>
              <div className="sync-stats">
                {(columns[r.key] || []).map((c) => (
                  <div key={c.key} className="sync-stat" title={c.hint}>
                    <span className="sync-stat__label">{c.label}</span>
                    {c.tone && r[c.key] ? <Badge variant={c.tone}>{n(r[c.key])}</Badge> : <strong>{n(r[c.key])}</strong>}
                  </div>
                ))}
              </div>
              {r.createdIds?.length > 0 && (
                <p className="field__hint">
                  New: {r.createdIds.join(', ')}
                  {r.created > r.createdIds.length ? ` … +${r.created - r.createdIds.length} more` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="sync-form">
          <a className="sync-sheet" href={sheetUrl} target="_blank" rel="noreferrer noopener">
            <FileSpreadsheet size={18} />
            <span>
              <strong>Fifth Season Google Sheet</strong>
              <small>Must be shared as “Anyone with the link can view”</small>
            </span>
            <ExternalLink size={14} />
          </a>

          <p className="form-section">Sheet tabs</p>
          <div className="sync-modes">
            {tabs.map((t) => (
              <label key={t.key} className={`sync-choice ${selected.includes(t.key) ? 'is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(t.key)}
                  disabled={tabs.length === 1}
                  onChange={() => setSelected((s) => (s.includes(t.key) ? s.filter((x) => x !== t.key) : [...s, t.key]))}
                />
                <span>
                  <strong>{t.label}</strong>
                  <small>Tab: “{t.tabName}”</small>
                  <small>{t.description}</small>
                </span>
              </label>
            ))}
          </div>
          {notes && <p className="form-note form-note--soft">{notes}</p>}
          {error && <p className="sync-error">{error}</p>}

          {logs.length > 0 && (
            <>
              <p className="form-section">Recent syncs</p>
              <ul className="sync-history">
                {logs.slice(0, 5).map((l) => (
                  <li key={l.id}>
                    {l.status === 'SUCCESS' ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="bad" />}
                    <span className="sync-history__what">
                      {l.tabs.map((k) => tabs.find((t) => t.key === k)?.label || k).join(', ')}
                      {l.status === 'FAILED' && <small title={l.error}> — {l.error}</small>}
                    </span>
                    <span className="sync-history__meta">
                      {l.started_by || '—'} · {when(l.finished_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
