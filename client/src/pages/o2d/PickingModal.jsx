import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageCheck, Save, Scissors, PauseCircle, Undo2, SearchX, GitBranch, GitMerge, RotateCw, History, ArrowLeft } from 'lucide-react';
import { PICK_TABS } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Textarea, Switch } from '../../components/ui/FormControls';
import { useO2D } from '../../context/O2DContext';
import { RemarksSection } from '../../components/o2d/RemarksSection';
import { DECISION, DEPT_LABEL } from '../crm/StockCheckModal';

const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const STATE = {
  PICKED: { label: 'Picked', variant: 'success' },
  PARTIAL: { label: 'Partial', variant: 'warning' },
  PENDING: { label: 'To pick', variant: 'neutral' },
  NOT_FOUND: { label: 'Not found', variant: 'danger' },
};
const TAB_OF_DEPT = { CUT: 'CUT', ROLL: 'ROLL', IN_CHECKING: 'IN_CHECKING' };

/** One order at Picking: view, Pickup (tick pieces), batches, and moving it on. */
export function PickingModal({ id, onClose, onChanged }) {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const canPick = can('picking', 'edit');
  const canOrder = can(o2d.perm, 'edit');
  const canMove = canPick && canOrder;

  const [d, setD] = useState(null);
  const [picking, setPicking] = useState(false);
  const [lineId, setLineId] = useState(null);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(null); // { kind, ... }
  const [text, setText] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(
    () =>
      o2d.apis.picking.get(id).then(setD).catch((err) => {
        toast.error('Could not open order', getErrorMessage(err));
        onClose();
      }),
    [id, toast, onClose]
  );
  useEffect(() => {
    load();
  }, [load]);

  const line = d?.lines.find((l) => l.id === lineId) || null;

  /** Server answers a save with the fresh order, or { moved } when the order went on to Cutting. */
  const applySave = (r) => {
    if (r.data?.moved) {
      toast.success(r.message);
      onChanged();
      onClose();
      return true;
    }
    setD(r.data);
    onChanged();
    if (r.data?.auto?.failed) toast.error('Picks saved, but the automatic move failed', r.data.auto.error);
    return false;
  };

  const run = async (key, fn) => {
    setBusy(key);
    try {
      return await fn();
    } catch (err) {
      toast.error('Something went wrong', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const openDialog = (kind, extra = {}) => {
    setText('');
    setDialog({ kind, ...extra });
  };

  const done = (msg) => {
    toast.success(msg);
    onChanged();
    onClose();
  };

  const sendToCutting = (allowShortPick = false) =>
    run('cut', async () => {
      try {
        const r = await o2d.apis.picking.sendToCutting(id, allowShortPick);
        setDialog(null);
        done(r.message);
      } catch (err) {
        const data = err.response?.data;
        if (data?.code === 'SHORT_PICK') return setDialog({ kind: 'short', short: data.short });
        throw err;
      }
    });

  const submitDialog = () => {
    const k = dialog.kind;
    if (k === 'batch') return run('batch', async () => { applySave(await o2d.apis.picking.saveBatch(id, text.trim() || null)) || toast.success('Picking progress saved'); setDialog(null); });
    if (k === 'notfound') return run('nf', async () => { applySave(await o2d.apis.picking.notFound(id, dialog.lineId, text.trim() || null)); setDialog(null); });
    if (k === 'hold') return run('hold', async () => { await o2d.apis.orders.action(id, 'hold', { reason: text.trim() }); setDialog(null); done('Order put on hold'); });
    if (k === 'back') return run('back', async () => { const r = await o2d.apis.picking.sendBack(id, text.trim()); setDialog(null); done(r.message); });
    if (k === 'short') return sendToCutting(true);
    if (k === 'split') return run('split', async () => { const r = await o2d.apis.picking.split(id); setD(r.data); onChanged(); setDialog(null); toast.success(r.message); });
    if (k === 'merge') return run('merge', async () => { const r = await o2d.apis.picking.merge(id, d.merge_option.id); setDialog(null); done(r.message); });
  };

  const unsaved = d?.lines.some((l) => l.picks.some((p) => p.batch_no == null) || (l.not_found && l.not_found.batch_no == null));
  const anyPicked = d?.lines.some((l) => l.picked > 0);
  const anyNotFound = d?.lines.some((l) => l.state === 'NOT_FOUND');
  const orderNo = d ? d.system_order_no || d.enquiry_number : '';
  const startPicking = () => {
    setPicking(true);
    setLineId((d.lines.find((l) => l.state !== 'PICKED') || d.lines[0])?.id || null);
  };

  const footer = d && (
    <div className="picking-foot">
      <div className="picking-foot__left">
        {canOrder && <Button variant="ghost" icon={PauseCircle} disabled={!!busy} onClick={() => openDialog('hold')}>Hold</Button>}
        {canOrder && <Button variant="ghost" icon={Undo2} disabled={!!busy} onClick={() => openDialog('back')}>Send Back</Button>}
      </div>
      <div className="picking-foot__right">
        {canPick && (
          <Button variant="secondary" icon={Save} loading={busy === 'batch'} disabled={!!busy || !unsaved} onClick={() => openDialog('batch')}>
            Save Picking Progress
          </Button>
        )}
        {canMove && d.can_split && (
          <Button variant="secondary" icon={GitBranch} disabled={!!busy} onClick={() => openDialog('split')}>Split: Send Ready, Hold Rest</Button>
        )}
        {!picking && canPick && (
          <Button icon={PackageCheck} onClick={startPicking}>{anyPicked ? 'Continue Picking' : 'Pickup'}</Button>
        )}
        {canMove && (
          <span title={!anyPicked ? 'Nothing picked yet' : anyNotFound ? 'Resolve Not Found items or split first' : ''}>
            <Button icon={Scissors} loading={busy === 'cut'} disabled={!!busy || !anyPicked || anyNotFound} onClick={() => sendToCutting(false)}>
              {d.merge_option ? 'Send as its own order' : 'Send to Cutting'}
            </Button>
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open={!dialog}
        size="xl"
        busy={!!busy}
        onClose={onClose}
        title={d ? `${orderNo} · Picking` : 'Picking'}
        subtitle={d ? `${d.client_id} — ${d.company_name}${d.transport_name ? ` · ${d.transport_name}` : ''}` : ''}
        footer={footer}
      >
        {!d ? (
          <Loader label="Loading…" />
        ) : (
          <div className="picking">
            {d.continues && <p className="picking__note"><Badge size="sm" variant="info">Continues {d.continues}</Badge> Remaining items of a split order.</p>}
            {d.split_children.length > 0 && (
              <p className="picking__note">Ready items already sent ahead as {d.split_children.map((c) => c.order_no).join(', ')}.</p>
            )}
            {d.merge_option && canMove && (
              <div className="picking__merge">
                <span>Every remaining item is picked. Send as its own order, or merge into <strong>{d.merge_option.order_no}</strong>?</span>
                <Button size="sm" icon={GitMerge} onClick={() => openDialog('merge')}>Merge into {d.merge_option.order_no}</Button>
              </div>
            )}
            {d.auto_advance_failed && canMove && (
              <div className="picking__merge picking__merge--warn">
                <span>{d.auto_advance_failed}</span>
                <Button size="sm" variant="secondary" icon={RotateCw} loading={busy === 'retry'}
                  onClick={() => run('retry', async () => { const r = await o2d.apis.picking.autoAdvance(id); if (!applySave(r)) toast.info(r.message); })}>
                  Retry automatic move
                </Button>
              </div>
            )}
            {d.sent_back && <p className="picking__note">Sent back from Cutting — it will not move on automatically; send it to Cutting by hand.</p>}

            <div className={`picking__body ${picking ? 'is-picking' : ''}`}>
              <div className="picking__lines">
                <table className="table">
                  <thead>
                    <tr><th>Line</th><th>Item</th><th className="num">Required</th><th className="num">Picked</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.id} className={`${picking ? 'is-clickable' : ''} ${lineId === l.id && picking ? 'is-picked' : ''}`} onClick={() => picking && setLineId(l.id)}>
                        <td className="mono mono--plain">{l.line}</td>
                        <td className="cell-wrap">
                          <strong>{l.item_name}</strong>
                          {l.item_name !== l.sku_code && <div className="cell-sub">Ordered: {l.sku_code}</div>}
                          {l.decision && (
                            <div className="cell-sub picking__decision">
                              Stock Check: <Badge size="sm" variant={DECISION[l.decision]?.variant}>{DECISION[l.decision]?.label || l.decision}</Badge>
                              {l.source_type && <> · {DEPT_LABEL[l.source_type]}</>}
                              {(l.decision === 'SMALL_QTY' || l.decision === 'ALT_WIDTH') && l.panels && <> · {l.panels} × {qty(l.panel_length)} {l.unit}</>}
                              {l.decision === 'PARTIAL' && <> · ordered {qty(l.ordered_qty)}, rest {qty(l.ordered_qty - l.required)} later</>}
                              {l.check_note && <div>{l.check_note}</div>}
                            </div>
                          )}
                        </td>
                        <td className="num">{qty(l.required)} {l.unit}</td>
                        <td className="num">{qty(l.picked)}{l.short > 0 && l.picked > 0 && <div className="cell-sub">short {qty(l.short)}</div>}</td>
                        <td>
                          <Badge size="sm" variant={STATE[l.state].variant}>{STATE[l.state].label}</Badge>
                          {l.not_found?.reason && <div className="cell-sub">{l.not_found.reason}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {picking && line && (
                <PiecesPanel
                  key={line.id}
                  orderId={id}
                  line={line}
                  canPick={canPick}
                  busy={busy}
                  setBusy={setBusy}
                  onSaved={applySave}
                  onNotFound={() => openDialog('notfound', { lineId: line.id })}
                  onBack={() => setPicking(false)}
                />
              )}
            </div>

            <RemarksSection orderId={id} />

            <div className="picking__history">
              <button type="button" className="inline-link" onClick={() => setShowHistory((s) => !s)}>
                <History size={13} /> Batch history ({d.batches.length}{d.batches.length ? ' saved' : ''})
              </button>
              {showHistory && <BatchHistory batches={d.batches} lines={d.lines} />}
            </div>
          </div>
        )}
      </Modal>

      {dialog && (
        <PickDialog dialog={dialog} text={text} setText={setText} busy={busy} orderNo={orderNo} mergeInto={d?.merge_option?.order_no}
          onCancel={() => setDialog(null)} onSubmit={submitDialog} />
      )}
    </>
  );
}

/** Pieces of one line in one source tab: tick until the ticked total covers the line. */
function PiecesPanel({ orderId, line, canPick, busy, setBusy, onSaved, onNotFound, onBack }) {
  const o2d = useO2D();
  const toast = useToast();
  const [tab, setTab] = useState(TAB_OF_DEPT[line.source_type] || (line.sku_code.toUpperCase().startsWith('CUT ') ? 'CUT' : 'ROLL'));
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [ioc, setIoc] = useState(false);

  useEffect(() => {
    setData(null);
    o2d.apis.picking.pieces(orderId, line.id, tab).then((r) => {
      setData(r);
      const mine = r.pieces.filter((p) => p.picked_here);
      setSel(new Set(mine.map((p) => p.id)));
      // Mark for IOC is ON by default for Roll pieces; a saved choice wins
      setIoc(o2d.ioc && (mine.length ? mine.some((p) => p.ioc_marked) : true));
    }).catch((err) => toast.error('Could not load stock', getErrorMessage(err)));
  }, [orderId, line, tab, toast]);

  const pieces = data?.pieces || [];
  const pieceQty = (p) => (p.picked_here ? p.picked_qty : p.qty);
  const original = useMemo(() => new Set(pieces.filter((p) => p.picked_here).map((p) => p.id)), [pieces]);
  const changed = sel.size !== original.size || [...sel].some((x) => !original.has(x)) || (o2d.ioc && tab === 'ROLL' && pieces.some((p) => p.picked_here && p.batch_no == null && !!p.ioc_marked !== ioc));
  const tabPicked = pieces.filter((p) => p.picked_here).reduce((s, p) => s + p.picked_qty, 0);
  const otherTabs = Math.max(0, line.picked - tabPicked);
  const selected = pieces.filter((p) => sel.has(p.id)).reduce((s, p) => s + pieceQty(p), 0);
  const total = otherTabs + selected;

  const toggle = (p) => setSel((s) => {
    const n = new Set(s);
    if (n.has(p.id)) n.delete(p.id);
    else n.add(p.id);
    return n;
  });

  const save = async () => {
    setBusy('pick');
    try {
      const r = await o2d.apis.picking.savePicks(orderId, line.id, { tab, stockIds: [...sel], iocMarked: o2d.ioc && tab === 'ROLL' ? ioc : null });
      if (!onSaved(r)) toast.success(r.message, `Line ${line.line}`);
    } catch (err) {
      toast.error('Could not save picks', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="picking__pieces">
      <div className="picking__pieces-head">
        <button type="button" className="inline-link" onClick={onBack}><ArrowLeft size={13} /> Order view</button>
        <div>
          <strong>Line {line.line} · {line.item_name}</strong>
          <div className="cell-sub">Required {qty(line.required)} {line.unit} · In Checking total {data ? qty(data.in_checking_qty) : '…'} {line.unit}</div>
        </div>
      </div>

      <div className="segmented" role="tablist" aria-label="Source">
        {PICK_TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} disabled={!!busy} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!data ? (
        <Loader label="Loading stock…" />
      ) : (
        <>
          <div className="table-wrap picking__piece-table">
            <table className="table">
              <thead>
                <tr><th /><th>Main Item</th><th>Sub Item / Rack</th><th>Lot No</th><th className="num">Qty</th><th /></tr>
              </thead>
              <tbody>
                {pieces.map((p) => {
                  const lockedBatch = p.picked_here && p.batch_no != null;
                  const disabled = !canPick || !!p.locked_by || p.picked_other_tab || lockedBatch;
                  return (
                    <tr key={p.id} className={sel.has(p.id) ? 'is-picked' : ''} onClick={() => !disabled && toggle(p)}>
                      <td><input type="checkbox" checked={sel.has(p.id)} disabled={disabled} readOnly aria-label={`${p.rack_no || p.item_name}`} /></td>
                      <td className="cell-wrap">{p.item_name}</td>
                      <td>{p.rack_no || '—'}</td>
                      <td className="mono mono--plain">{p.lot_no || '—'}</td>
                      <td className="num">{qty(pieceQty(p))}</td>
                      <td className="cell-sub">
                        {p.locked_by ? `Picked for ${p.locked_by}` : p.picked_other_tab ? 'Picked in another tab' : lockedBatch ? `Saved in batch ${p.batch_no}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!pieces.length && <p className="cell-sub stock-dept__empty">No {tab.replace('_', ' ').toLowerCase()} stock for this item.</p>}
          </div>

          <div className="picking__tally">
            <span>Ticked <strong>{qty(selected)}</strong>{otherTabs > 0 && <> + other tabs {qty(otherTabs)}</>} = <strong>{qty(total)}</strong> of {qty(line.required)}</span>
            {total >= line.required ? <Badge size="sm" variant="success">Covered{total > line.required ? ` · leftover ${qty(total - line.required)}` : ''}</Badge> : <Badge size="sm" variant="warning">Short {qty(line.required - total)}</Badge>}
          </div>

          {canPick && (
            <div className="picking__actions">
              {o2d.ioc && tab === 'ROLL' && <Switch checked={ioc} onChange={setIoc} label="Mark for IOC" />}
              {line.state !== 'PICKED' && <Button size="sm" variant="ghost" icon={SearchX} disabled={!!busy} onClick={onNotFound}>Mark Not Found</Button>}
              <Button size="sm" icon={Save} loading={busy === 'pick'} disabled={!!busy || !changed} onClick={save}>Save Picks</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Saved batches (1, 2, 3…) and, per line, every attempt that touched it. */
function BatchHistory({ batches, lines }) {
  if (!batches.length) return <p className="cell-sub">No batch saved yet.</p>;
  const perLine = lines.map((l) => ({
    line: l.line,
    item: l.item_name,
    attempts: batches
      .map((b) => {
        const picked = (b.picks || []).filter((p) => p.line === l.line).reduce((s, p) => s + p.qty, 0);
        const nf = (b.not_found || []).some((n) => n.line === l.line);
        return picked > 0 ? `attempt ${b.batch}: picked ${qty(picked)}` : nf ? `attempt ${b.batch}: Not Found` : null;
      })
      .filter(Boolean),
  }));
  return (
    <div className="picking__batches">
      {batches.map((b) => (
        <div key={b.batch} className="picking__batch">
          <div>
            <strong>Batch {b.batch}/{batches.length}</strong> · {qty(b.total)} picked · {b.saved_by || '—'} · {stamp(b.saved_at)}
            {b.remark && <span className="cell-sub"> · {b.remark}</span>}
          </div>
          <ul>
            {(b.picks || []).map((p, i) => (
              <li key={i}>{p.line} · {p.source} · {p.rack_no || '—'} · lot {p.lot_no || '—'} · {qty(p.qty)}{p.ioc ? ' · IOC' : ''}</li>
            ))}
            {(b.not_found || []).map((n, i) => <li key={`nf${i}`} className="text-danger">{n.line} · Not Found{n.reason ? ` — ${n.reason}` : ''}</li>)}
          </ul>
        </div>
      ))}
      <div className="picking__batch">
        <strong>Item history</strong>
        <ul>
          {perLine.filter((l) => l.attempts.length).map((l) => <li key={l.line}>{l.line} {l.item}: {l.attempts.join(', ')}</li>)}
        </ul>
      </div>
    </div>
  );
}

const DIALOG = {
  batch: { title: 'Save Picking Progress', label: 'Save Batch', input: 'Remark (optional)', required: false },
  notfound: { title: 'Mark item Not Found', label: 'Mark Not Found', input: 'Reason (optional)', required: false, max: 500 },
  hold: { title: 'Hold order', label: 'Hold', input: 'Reason', required: true, tone: 'danger' },
  back: { title: 'Send back to Stock Check', label: 'Send Back', input: 'Reason', required: true, tone: 'danger' },
  short: { title: 'Some items are short', label: 'Send Anyway', tone: 'danger' },
  split: { title: 'Split the order?', label: 'Split' },
  merge: { title: 'Merge into the split order?', label: 'Merge' },
};

function PickDialog({ dialog, text, setText, busy, orderNo, mergeInto, onCancel, onSubmit }) {
  const cfg = DIALOG[dialog.kind];
  return (
    <Modal
      open
      busy={!!busy}
      onClose={onCancel}
      title={cfg.title}
      subtitle={orderNo}
      footer={
        <>
          <Button variant="secondary" disabled={!!busy} onClick={onCancel}>Cancel</Button>
          <Button variant={cfg.tone === 'danger' ? 'danger' : 'primary'} loading={!!busy} disabled={cfg.required && !text.trim()} onClick={onSubmit}>{cfg.label}</Button>
        </>
      }
    >
      {dialog.kind === 'short' && (
        <>
          <p className="cell-sub" style={{ marginBottom: 8 }}>These items are not fully picked. Send to Cutting anyway?</p>
          <ul className="picking__short">
            {dialog.short.map((s) => <li key={s.line}><strong>{s.line}</strong> {s.item} — short {qty(s.short)} {s.unit} (picked {qty(s.picked)} of {qty(s.required)})</li>)}
          </ul>
        </>
      )}
      {dialog.kind === 'split' && (
        <p className="cell-sub">Fully picked items go to Cutting now as a new order with its own order number. The short items stay here at Picking on {orderNo}.</p>
      )}
      {dialog.kind === 'merge' && (
        <p className="cell-sub">The remaining items and their picks move onto {mergeInto}. {orderNo} will then be closed (cancelled as merged).</p>
      )}
      {cfg.input && <Textarea label={cfg.input} required={cfg.required} rows={3} maxLength={cfg.max || 1000} value={text} onChange={(e) => setText(e.target.value)} />}
    </Modal>
  );
}
