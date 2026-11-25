import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, XCircle, FileSpreadsheet, ExternalLink, Tag, Layers } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Loader';
import { inventoryApi, STOCK_TYPES, STOCK_LABEL } from '../../api/inventory';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

const n = (v) => (v ?? 0).toLocaleString('en-IN');
const when = (d) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function SyncModal({ open, sheet, onClose, onSynced }) {
  const { can } = useAuth();
  const toast = useToast();
  const canFull = can('inventory', 'create') && can('inventory', 'edit');

  const [types, setTypes] = useState(STOCK_TYPES.map((t) => t.key));
  const [mode, setMode] = useState(canFull ? 'full' : 'price');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    inventoryApi.syncLogs().then(setLogs).catch(() => setLogs([]));
  }, [open]);

  const toggleType = (key) => setTypes((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]));

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const data = await inventoryApi.sync({ stock_types: types, mode });
      setResult(data);
      const totals = data.results.reduce((a, r) => ({ c: a.c + (r.created || 0), u: a.u + (r.updated || 0), f: a.f + (r.filled || 0) }), { c: 0, u: 0, f: 0 });
      toast.success(
        'Google Sheet synced',
        mode === 'full' ? `${n(totals.c)} created · ${n(totals.u)} updated` : `${n(totals.f)} prices filled`
      );
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
      <Button icon={RefreshCw} onClick={run} loading={running} disabled={!types.length}>
        {running ? 'Syncing…' : 'Start Sync'}
      </Button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} busy={running} size="lg" title="Sync with Google Sheet" subtitle="Pull the latest stock directly from the shared sheet" footer={footer}>
      {running ? (
        <div className="sync-running">
          <Spinner size={30} />
          <p className="sync-running__title">Fetching stock from Google Sheets…</p>
          <p className="sync-running__sub">Large tabs (50k+ rows) can take up to a minute. Please keep this window open.</p>
        </div>
      ) : result ? (
        <SyncResult result={result} />
      ) : (
        <div className="sync-form">
          <a className="sync-sheet" href={sheet?.url} target="_blank" rel="noreferrer noopener">
            <FileSpreadsheet size={18} />
            <span>
              <strong>Fifth Season stock sheet</strong>
              <small>Must be shared as “Anyone with the link can view”</small>
            </span>
            <ExternalLink size={14} />
          </a>

          <p className="form-section">Sheet tabs</p>
          <div className="sync-tabs">
            {STOCK_TYPES.map((t) => (
              <label key={t.key} className={`sync-choice ${types.includes(t.key) ? 'is-on' : ''}`}>
                <input type="checkbox" checked={types.includes(t.key)} onChange={() => toggleType(t.key)} />
                <span>
                  <strong>{t.label}</strong>
                  <small>Tab: “{sheet?.tabs?.[t.key]}”</small>
                </span>
              </label>
            ))}
          </div>

          <p className="form-section">What to sync</p>
          <div className="sync-modes">
            <label className={`sync-choice ${mode === 'full' ? 'is-on' : ''} ${!canFull ? 'is-disabled' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'full'} disabled={!canFull} onChange={() => setMode('full')} />
              <Layers size={18} className="sync-choice__icon" />
              <span>
                <strong>Full sync</strong>
                <small>Creates new items and updates changed ones (matched by item name + rack no). Unchanged items are skipped.</small>
              </span>
            </label>
            <label className={`sync-choice ${mode === 'price' ? 'is-on' : ''}`}>
              <input type="radio" name="mode" checked={mode === 'price'} onChange={() => setMode('price')} />
              <Tag size={18} className="sync-choice__icon" />
              <span>
                <strong>Price only</strong>
                <small>Fills blank prices from the sheet. Never overwrites an existing, different price.</small>
              </span>
            </label>
          </div>
          {!canFull && <p className="field__hint">Full sync needs Create + Edit permission on Inventory.</p>}
          {error && <p className="sync-error">{error}</p>}

          {logs.length > 0 && (
            <>
              <p className="form-section">Recent syncs</p>
              <ul className="sync-history">
                {logs.slice(0, 5).map((l) => (
                  <li key={l.id}>
                    {l.status === 'SUCCESS' ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="bad" />}
                    <span className="sync-history__what">
                      {l.mode === 'price' ? 'Price only' : 'Full sync'} · {l.stock_types.map((s) => STOCK_LABEL[s]).join(', ')}
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

function SyncResult({ result }) {
  const isPrice = result.mode === 'price';
  return (
    <div className="sync-result">
      <div className="sync-result__banner">
        <CheckCircle2 size={22} />
        <div>
          <strong>Sync completed in {(result.durationMs / 1000).toFixed(1)}s</strong>
          <p>{isPrice ? 'Blank prices were filled from the sheet.' : 'Inventory now matches the Google Sheet.'}</p>
        </div>
      </div>

      <div className="table-wrap table-wrap--flush">
        <table className="table">
          <thead>
            <tr>
              <th>Tab</th>
              <th className="num">Sheet rows</th>
              {isPrice ? (
                <>
                  <th className="num">With price</th>
                  <th className="num">Filled</th>
                  <th className="num">Conflicts</th>
                  <th className="num">Not in ERP</th>
                </>
              ) : (
                <>
                  <th className="num">Created</th>
                  <th className="num">Updated</th>
                  <th className="num">Unchanged</th>
                  <th className="num">Skipped</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {result.results.map((r) => (
              <tr key={r.stockType}>
                <td>
                  <p className="cell-main">{STOCK_LABEL[r.stockType]}</p>
                  <p className="cell-sub">{r.tab}</p>
                </td>
                <td className="num">{n(r.sheetRows)}</td>
                {isPrice ? (
                  <>
                    <td className="num">{n(r.withPrice)}</td>
                    <td className="num">
                      <Badge variant={r.filled ? 'success' : 'neutral'}>{n(r.filled)}</Badge>
                    </td>
                    <td className="num">
                      <Badge variant={r.conflicts ? 'warning' : 'neutral'}>{n(r.conflicts)}</Badge>
                    </td>
                    <td className="num">{n(r.notFound)}</td>
                  </>
                ) : (
                  <>
                    <td className="num">
                      <Badge variant={r.created ? 'success' : 'neutral'}>{n(r.created)}</Badge>
                    </td>
                    <td className="num">
                      <Badge variant={r.updated ? 'info' : 'neutral'}>{n(r.updated)}</Badge>
                    </td>
                    <td className="num">{n(r.unchanged)}</td>
                    <td className="num" title="Rows without an item name, or duplicate rows">
                      {n(r.skippedBlank + r.duplicates)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.results.some((r) => r.invalidNumbers) && (
        <p className="field__hint">
          Some rows had a quantity/price that is not a number — those values were imported as blank (price) or 0 (quantity).
        </p>
      )}

      {isPrice && result.results.some((r) => r.conflictSamples?.length) && (
        <>
          <p className="form-section">Price conflicts (kept ERP price)</p>
          <div className="table-wrap table-wrap--flush sync-conflicts">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Rack</th>
                  <th className="num">ERP price</th>
                  <th className="num">Sheet price</th>
                </tr>
              </thead>
              <tbody>
                {result.results.flatMap((r) =>
                  r.conflictSamples.map((c) => (
                    <tr key={`${r.stockType}-${c.item_name}-${c.rack_no}`}>
                      <td>{c.item_name}</td>
                      <td>{c.rack_no || '—'}</td>
                      <td className="num">₹{Number(c.old_price).toLocaleString('en-IN')}</td>
                      <td className="num">₹{Number(c.new_price).toLocaleString('en-IN')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
