import { useCallback, useEffect, useState } from 'react';
import { PackageSearch, PauseCircle, CheckCircle2, ChevronLeft, ChevronRight, FileText, Send, Link2, ExternalLink, Wallet } from 'lucide-react';
import { crmApi, inr, stampFmt, LEDGER_RECIPIENTS } from '../../api/crm';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Textarea } from '../../components/ui/FormControls';
import { Input } from '../../components/ui/Input';
import { RemarksSection } from '../../components/o2d/RemarksSection';
import { CustomerProfile, SuggestionPanel, ViewTabs } from '../../components/clients/CustomerProfile';

export const DEPT_LABEL = { CUT: 'Cut Dept', ROLL: 'Roll Dept', IN_CHECKING: 'In Checking' };
const DEPTS = Object.keys(DEPT_LABEL);
export const DECISION = {
  AVAILABLE: { label: 'Available', variant: 'success', hint: 'Full required qty from one department' },
  ALT_COLOR: { label: 'Alternative color', variant: 'info', hint: 'Same fabric and width' },
  ALT_FABRIC: { label: 'Alternative fabric', variant: 'info', hint: 'Same color and width' },
  ALT_WIDTH: { label: 'Alternative width', variant: 'info', hint: 'Same fabric and color' },
  PARTIAL: { label: 'Partially', variant: 'warning', hint: 'Part of the qty now, the rest delivered later' },
  SMALL_QTY: { label: 'Small Qty', variant: 'warning', hint: 'No single lot — small pieces as No. of Panels × Length' },
  DROP: { label: 'Drop item', variant: 'danger', hint: 'Remove this item from the order' },
};
const qtyFmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/**
 * CRM › Stock Check of one order. Shows client credit, items with rate × qty and grand total;
 * "Stock Check" switches to the item-wise check (one modal at a time, so Escape closes only the top one).
 */
export function StockCheckModal({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('crm_stock_check', 'edit');
  const [d, setD] = useState(null);
  const [checkIndex, setCheckIndex] = useState(null); // item index being checked
  const [holdOpen, setHoldOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('check');

  const load = useCallback(
    () =>
      crmApi.stock(id).then(setD).catch((err) => {
        toast.error('Could not open order', getErrorMessage(err));
        onClose();
      }),
    [id, toast, onClose]
  );
  useEffect(() => {
    load();
  }, [load]);

  const startCheck = () => {
    const first = d.items.findIndex((i) => !i.decision);
    setCheckIndex(first === -1 ? 0 : first);
  };

  const complete = async () => {
    setBusy(true);
    try {
      const r = await crmApi.completeStock(id);
      const t = r.data.tracking;
      toast.success(r.message, t.sent ? `Tracking link sent to ${t.to}` : `Tracking link not sent: ${t.reason || 'no WhatsApp number'}`);
      onChanged();
      onClose();
    } catch (err) {
      toast.error('Could not complete stock check', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (checkIndex != null && d) {
    return (
      <ItemCheckModal
        order={d}
        index={checkIndex}
        onIndex={setCheckIndex}
        onSaved={(next) => {
          setD(next);
          onChanged();
        }}
        onClose={() => setCheckIndex(null)}
      />
    );
  }

  const c = d?.client;
  const allChecked = d && d.checked === d.items.length;
  // Same rules as the server: every item checked; cash customers also need a fresh proforma and the advance
  // (for others the server makes / refreshes the proforma on Complete)
  const blockReason = !d
    ? ''
    : !allChecked
      ? 'Check every item first'
      : !d.cash.is_cash
        ? ''
        : !d.proforma
          ? 'Generate the Proforma Invoice first'
          : d.proforma.stale
            ? 'Regenerate the Proforma Invoice'
            : !d.advance
              ? 'Cash customer — record the advance first'
              : '';

  return (
    <>
      <Modal
        open={!holdOpen}
        size="xl"
        busy={busy}
        onClose={onClose}
        title={d ? `${d.enquiry_number} · Stock Check` : 'Stock Check'}
        subtitle={c ? `${c.client_id} — ${c.company_name}${c.city ? ` · ${c.city}` : ''}` : ''}
        footer={
          d &&
          canEdit && (
            <>
              <Button variant="ghost" icon={PauseCircle} disabled={busy} onClick={() => setHoldOpen(true)}>Hold Entire Order</Button>
              <Button variant="secondary" icon={PackageSearch} disabled={busy} onClick={startCheck}>
                {d.checked ? 'Continue Stock Check' : 'Stock Check'}
              </Button>
              <span title={blockReason}>
                <Button icon={CheckCircle2} loading={busy} disabled={!!blockReason} onClick={complete}>Complete → Picking</Button>
              </span>
            </>
          )
        }
      >
        {!d ? (
          <Loader label="Loading…" />
        ) : (
        <>
          <ViewTabs value={view} onChange={setView} first="Stock Check" />
          {view === 'history' ? (
            <CustomerProfile clientId={c.id} />
          ) : view === 'suggestion' ? (
            <SuggestionPanel />
          ) : (
          <div className="crm-pay">
            <div className="crm-facts">
              <div>
                <span>Credit limit</span>
                <strong>{c.credit_limit != null ? inr(c.credit_limit) : 'Not set'}</strong>
                {d.cash.is_cash ? (
                  <>
                    <Badge size="sm" variant="danger">Cash customer</Badge>
                    <small>Order above {inr(d.cash.threshold)} (limit + 10%)</small>
                  </>
                ) : c.credit_limit != null ? (
                  <small>Cash above {inr(d.cash.threshold)} (limit + 10%)</small>
                ) : (
                  <small>Set it in Client Master to apply the cash rule</small>
                )}
              </div>
              <div><span>Credit days</span><strong>{c.credit_days != null ? `${c.credit_days} days` : 'Not set'}</strong></div>
              <div>
                <span>Outstanding</span>
                <strong>{inr(c.outstanding)}</strong>
              </div>
              <div><span>Payment</span><strong>{c.skip_payment_check ? 'Skip Payment customer' : c.payment_mode || '—'}</strong>{c.overdue_bills > 0 && <small>{c.overdue_bills} overdue bill(s)</small>}</div>
            </div>

            <h4 className="crm-pay__title">
              Items <span className="cell-sub">· {d.checked}/{d.items.length} checked</span>
            </h4>
            <div className="table-wrap crm-pay__bills stock-items">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    <th className="num">Total</th>
                    <th>Stock (Cut / Roll / In Chk)</th>
                    <th>Check</th>
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it, i) => (
                    <tr key={it.id} className={it.decision === 'DROP' ? 'is-dropped' : ''}>
                      <td className="cell-sub">{i + 1}</td>
                      <td className="cell-wrap">
                        <strong>{it.sku_code}</strong>
                        {it.catalogue_name && <div className="cell-sub">{it.catalogue_name}</div>}
                      </td>
                      <td className="num">
                        {qtyFmt(it.qty_out)} {it.unit}
                        {it.decision && it.qty_out !== it.qty && <div className="cell-sub">of {qtyFmt(it.qty)}</div>}
                      </td>
                      <td className="num">{it.rate != null ? inr(it.rate) : <span className="cell-sub">No rate</span>}</td>
                      <td className="num">{it.amount != null ? inr(it.amount) : '—'}</td>
                      <td className="cell-sub">{DEPTS.map((k) => qtyFmt(it.stock[k])).join(' / ')}</td>
                      <td>
                        {it.decision ? (
                          <>
                            <Badge size="sm" variant={DECISION[it.decision].variant}>{DECISION[it.decision].label}</Badge>
                            {it.alt_item && <div className="cell-sub">→ <strong>{it.alt_item}</strong></div>}
                            {it.source_type && <div className="cell-sub">{DEPT_LABEL[it.source_type]}</div>}
                            {it.note && <div className="cell-sub">{it.note}</div>}
                          </>
                        ) : (
                          <Badge size="sm" variant="neutral">Not checked</Badge>
                        )}
                      </td>
                      {canEdit && (
                        <td className="num">
                          <Button size="sm" variant="ghost" onClick={() => setCheckIndex(i)}>{it.decision ? 'Change' : 'Check'}</Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}><strong>Grand Total</strong>{d.unpriced_lines > 0 && <span className="cell-sub"> · {d.unpriced_lines} item(s) without rate</span>}</td>
                    <td className="num"><strong>{inr(d.grand_total)}</strong></td>
                    <td colSpan={canEdit ? 3 : 2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <ProformaPanel d={d} canEdit={canEdit} onUpdated={(next) => { setD(next); onChanged(); }} />
            <RemarksSection orderId={id} />
          </div>
          )}
        </>
        )}
      </Modal>

      {holdOpen && <HoldModal id={id} onClose={() => setHoldOpen(false)} onDone={() => { onChanged(); onClose(); }} />}
    </>
  );
}

function HoldModal({ id, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await crmApi.holdStock(id, reason.trim());
      toast.success(r.message, 'Resume it from O2D › On Hold to bring it back to Stock Check');
      onDone();
    } catch (err) {
      toast.error('Could not hold order', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      busy={busy}
      onClose={onClose}
      title="Hold entire order?"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>Hold Order</Button>
        </>
      }
    >
      <Textarea label="Reason" required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

/** Item-wise stock check: dept / rack / lot-wise stock and the CRM decision. */
function ItemCheckModal({ order, index, onIndex, onSaved, onClose }) {
  const toast = useToast();
  const item = order.items[index];
  const [av, setAv] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAv(null);
    setForm({
      decision: item.decision || '',
      source_type: item.source_type || item.dept,
      panels: item.panels ?? '',
      panel_length: item.panel_length ?? '',
      partial_qty: item.decision === 'PARTIAL' ? item.qty_out : '',
      note: item.note || '',
      alt_item: item.alt_item || '',
    });
    crmApi.availability(order.id, item.id).then((a) => {
      setAv(a);
      if (!item.decision) {
        if (a.dept === 'CUT') {
          // Cut item: Available only when ONE Cut lot covers the qty, else Partially (combine the Cut lots)
          const biggest = Math.max(0, ...a.depts.CUT.rows.map((r) => r.qty));
          if (biggest >= item.qty) setForm((f) => ({ ...f, source_type: 'CUT', decision: 'AVAILABLE' }));
          else if (a.depts.CUT.qty > 0) setForm((f) => ({ ...f, source_type: 'CUT', decision: 'SMALL_QTY' }));
        } else {
          // Suggest the department that can cover the full qty when nothing is decided yet
          const full = [a.dept, ...DEPTS].find((k) => a.depts[k].qty >= item.qty);
          if (full) setForm((f) => ({ ...f, source_type: full, decision: f.decision || 'AVAILABLE' }));
        }
      }
    }).catch((err) => toast.error('Could not load stock', getErrorMessage(err)));
  }, [order.id, item, toast]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const needsSource = form.decision === 'AVAILABLE' || form.decision === 'PARTIAL' || form.decision === 'SMALL_QTY';
  // A Cut item ("CUT …") is always taken from the Cut dept — no department choice, only its lots
  const cutMode = item.dept === 'CUT' && needsSource;
  const cutLots = av?.depts.CUT.rows || [];
  const biggestLot = Math.max(0, ...cutLots.map((r) => r.qty));
  const isAlt = form.decision?.startsWith('ALT_');
  const partialQty = form.decision === 'SMALL_QTY' && form.panels && form.panel_length ? Math.round(form.panels * form.panel_length * 100) / 100 : null;
  const altList = (isAlt && av?.alternatives?.[form.decision.slice(4)]) || [];
  const altPicked = altList.find((a) => a.alt_name === form.alt_item);
  const stockOf = altPicked ? altPicked.depts : av?.depts;
  // No manual department choice: Cut items use the Cut dept; others the item's own dept if it covers the qty, else the dept that does, else the one with the most stock
  const autoSource = (d) => !d ? item.dept : [item.dept, ...DEPTS].find((k) => d[k]?.qty >= item.qty) || [item.dept, ...DEPTS].reduce((m, k) => (d[k]?.qty > (d[m]?.qty ?? 0) ? k : m));
  const sourceType = cutMode ? 'CUT' : needsSource || isAlt ? autoSource(stockOf) : form.source_type;
  const srcQty = stockOf && sourceType ? stockOf[sourceType].qty : null;
  const srcRate = stockOf && sourceType ? stockOf[sourceType].rate : null;

  const save = async (go) => {
    setBusy(true);
    try {
      const next = await crmApi.saveItem(order.id, item.id, {
        decision: form.decision,
        source_type: form.decision === 'DROP' ? null : sourceType || null,
        panels: form.decision === 'SMALL_QTY' ? Number(form.panels) || null : null,
        panel_length: form.decision === 'SMALL_QTY' ? Number(form.panel_length) || null : null,
        partial_qty: form.decision === 'PARTIAL' ? Number(form.partial_qty) || null : null,
        note: form.note.trim() || null,
        alt_item: isAlt ? form.alt_item || null : null,
      });
      onSaved(next);
      toast.success('Item checked', item.sku_code);
      if (go === 'next' && index < order.items.length - 1) onIndex(index + 1);
      else onClose();
    } catch (err) {
      toast.error('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const last = index === order.items.length - 1;

  return (
    <Modal
      open
      size="xl"
      busy={busy}
      onClose={onClose}
      title={`Stock Check · Item ${index + 1} of ${order.items.length}`}
      subtitle={`${order.enquiry_number} — ${order.client.company_name}`}
      footer={
        <>
          <Button variant="ghost" icon={ChevronLeft} disabled={busy || index === 0} onClick={() => onIndex(index - 1)}>Previous</Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>Back to Order</Button>
          <Button icon={last ? CheckCircle2 : ChevronRight} loading={busy} disabled={!form.decision || (isAlt && !form.alt_item && !form.note.trim())} onClick={() => save(last ? 'close' : 'next')}>
            {last ? 'Save' : 'Save & Next'}
          </Button>
        </>
      }
    >
      <div className="stock-check">
        <div className="stock-check__item">
          <div>
            <strong>{item.sku_code}</strong>
            {item.catalogue_name && <div className="cell-sub">{item.catalogue_name}</div>}
          </div>
          <div className="stock-check__need">
            Required <strong>{qtyFmt(item.qty)} {item.unit}</strong>
            <span className="cell-sub">Ordered from {DEPT_LABEL[item.dept]}</span>
          </div>
        </div>

        {!av ? (
          <Loader label="Checking stock…" />
        ) : (
          <div className={`stock-depts ${cutMode ? 'stock-depts--single' : ''}`}>
            {(cutMode ? ['CUT'] : DEPTS).map((k) => {
              const dep = av.depts[k];
              const enough = dep.qty >= item.qty;
              return (
                <div key={k} className={`stock-dept ${sourceType === k && needsSource ? 'is-selected' : ''}`}>
                  <div className="stock-dept__head">
                    <span>{DEPT_LABEL[k]}</span>
                    <Badge size="sm" variant={dep.qty <= 0 ? 'neutral' : enough ? 'success' : 'warning'}>
                      {qtyFmt(dep.qty)} {item.unit}
                    </Badge>
                  </div>
                  <div className="cell-sub">Rate {dep.rate != null ? inr(dep.rate) : '—'}</div>
                  {dep.rows.length ? (
                    <table className="table stock-dept__rows">
                      <thead><tr><th>Rack</th><th>Lot</th><th className="num">Qty</th></tr></thead>
                      <tbody>
                        {dep.rows.map((r, i) => (
                          <tr key={i} title={r.item_name} className={cutMode && r.qty >= item.qty ? 'is-covering' : ''}>
                            <td>{r.rack_no || '—'}</td>
                            <td className="mono mono--plain">{r.lot_no || '—'}</td>
                            <td className="num">{qtyFmt(r.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="cell-sub stock-dept__empty">No stock</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <h4 className="crm-pay__title">Decision</h4>
        <div className="stock-decisions">
          {Object.entries(DECISION).map(([k, v]) => (
            <label key={k} className={`radio-pill ${form.decision === k ? 'is-on' : ''}`} title={v.hint}>
              <input type="radio" name="decision" value={k} checked={form.decision === k} onChange={() => set('decision', k)} />
              {v.label}
            </label>
          ))}
        </div>
        {form.decision && <p className="cell-sub crm-pay__hint">{DECISION[form.decision].hint}</p>}

        {isAlt && (
          <div className="stock-source">
            <span className="field__label">Alternatives from the sheet</span>
            {altList.length ? (
              <div className="table-wrap stock-alts">
                <table className="table table--clickable">
                  <thead>
                    <tr><th /><th>Item</th>{DEPTS.map((k) => <th key={k} className="num">{DEPT_LABEL[k]}</th>)}</tr>
                  </thead>
                  <tbody>
                    {altList.map((a) => (
                      <tr key={a.alt_name} className={form.alt_item === a.alt_name ? 'is-picked' : ''} onClick={() => set('alt_item', form.alt_item === a.alt_name ? '' : a.alt_name)}>
                        <td><input type="radio" readOnly checked={form.alt_item === a.alt_name} aria-label={a.alt_name} /></td>
                        <td className="cell-wrap"><strong>{a.alt_name}</strong></td>
                        {DEPTS.map((k) => (
                          <td key={k} className="num">
                            {a.depts[k].qty > 0 ? <Badge size="sm" variant={a.depts[k].qty >= item.qty ? 'success' : 'warning'}>{qtyFmt(a.depts[k].qty)}</Badge> : <span className="cell-sub">0</span>}
                            {a.depts[k].rate != null && a.depts[k].qty > 0 && <div className="cell-sub">{inr(a.depts[k].rate)}</div>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="cell-sub">No alternatives listed in the sheet for this item — write the customer's choice in the note.</p>
            )}
          </div>
        )}

        {cutMode && av && (
          <p className="cell-sub crm-pay__hint">
            Cut Dept · {cutLots.length} lot(s) · biggest lot {qtyFmt(biggestLot)} {item.unit} · total {qtyFmt(av.depts.CUT.qty)} {item.unit}
            {form.decision === 'AVAILABLE' && biggestLot < item.qty && <strong className="text-danger"> — no single lot has {qtyFmt(item.qty)}; choose Small Qty</strong>}
            {form.decision === 'PARTIAL' && Number(form.partial_qty) > biggestLot && <strong className="text-danger"> — no single lot has {qtyFmt(form.partial_qty)}; choose Small Qty</strong>}
            {form.decision === 'SMALL_QTY' && ' — the lots are combined as small qty'}
          </p>
        )}

        {((needsSource && !cutMode) || isAlt) && (
          <div className="stock-source">
            {srcQty != null && (
              <p className="cell-sub crm-pay__hint">
                {altPicked ? `${altPicked.alt_name} — ` : ''}{DEPT_LABEL[sourceType]}: {qtyFmt(srcQty)} {item.unit} available · rate {srcRate != null ? inr(srcRate) : 'not set'}
                {(form.decision === 'AVAILABLE' || altPicked) && srcQty < item.qty && <strong className="text-danger"> — not enough for {qtyFmt(item.qty)}</strong>}
              </p>
            )}
          </div>
        )}

        {form.decision === 'PARTIAL' && (
          <div className="form-grid">
            <Input label={`Qty to deliver now (${item.unit})`} type="number" min="0.01" step="0.01" required value={form.partial_qty} onChange={(e) => set('partial_qty', e.target.value)} />
            <p className="form-grid__full cell-sub">
              Now <strong>{qtyFmt(Number(form.partial_qty) || 0)} {item.unit}</strong> · later <strong>{qtyFmt(Math.max(0, item.qty - (Number(form.partial_qty) || 0)))} {item.unit}</strong>
              {srcQty != null && Number(form.partial_qty) > srcQty && <strong className="text-danger"> — more than available ({qtyFmt(srcQty)})</strong>}
            </p>
          </div>
        )}

        {form.decision === 'SMALL_QTY' && (
          <div className="form-grid">
            <Input label="No. of Panels" type="number" min="1" step="1" required value={form.panels} onChange={(e) => set('panels', e.target.value)} />
            <Input label={`Length per panel (${item.unit})`} type="number" min="0.01" step="0.01" required value={form.panel_length} onChange={(e) => set('panel_length', e.target.value)} />
            <p className="form-grid__full cell-sub">
              Qty = {form.panels || 0} × {form.panel_length || 0} = <strong>{qtyFmt(partialQty ?? 0)} {item.unit}</strong>
              {partialQty != null && srcQty != null && partialQty > srcQty && <strong className="text-danger"> — more than available ({qtyFmt(srcQty)})</strong>}
            </p>
          </div>
        )}

        <Textarea
          label={isAlt ? (altList.length ? 'Note' : 'Alternative item the customer chose') : 'Note'}
          required={isAlt && !form.alt_item}
          rows={2}
          maxLength={1000}
          value={form.note || ''}
          onChange={(e) => set('note', e.target.value)}
        />
        {item.checked_at && <p className="cell-sub crm-pay__hint">Last checked {stampFmt(item.checked_at)}{item.checked_by && ` by ${item.checked_by}`}</p>}
      </div>
    </Modal>
  );
}

/** Proforma Invoice (every order) + sharing and advance payment (cash customers only). */
function ProformaPanel({ d, canEdit, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [recipients, setRecipients] = useState(['CLIENT_OWNER']);
  const [results, setResults] = useState(null);
  const [adv, setAdv] = useState({ amount: '', reference: '', remark: '' });
  const p = d.proforma;
  const allChecked = d.checked === d.items.length;

  const run = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
    } catch (err) {
      toast.error('Something went wrong', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const generate = () => run('pf', async () => onUpdated((await crmApi.proforma(d.id)).data), p ? 'Proforma Invoice updated' : 'Proforma Invoice ready');
  const share = () =>
    run('share', async () => {
      const r = await crmApi.shareProforma(d.id, recipients);
      setResults(r.results);
      const sent = r.results.filter((x) => x.status === 'SENT').length;
      if (sent) toast.success('Proforma shared on WhatsApp', `${sent} of ${r.results.length} recipient(s)`);
      else toast.error('Nothing was sent', 'See the reasons below');
    });
  const saveAdvance = () =>
    run('adv', async () => onUpdated((await crmApi.advance(d.id, { amount: Number(adv.amount), reference: adv.reference.trim(), remark: adv.remark.trim() || null })).data), 'Advance recorded');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(p.link);
      toast.success('Link copied');
    } catch {
      toast.info('Open the Proforma and copy its address');
    }
  };

  return (
    <div className="proforma-panel">
      <div className="proforma-panel__head">
        <div>
          <h4 className="crm-pay__title"><FileText size={14} /> Proforma Invoice</h4>
          {p ? (
            <p className="cell-sub">
              <strong>{p.proforma_no}</strong> · {inr(p.total)} · made {stampFmt(p.generated_at)}{p.generated_by && ` by ${p.generated_by}`}
              {p.shared_at && <> · shared {stampFmt(p.shared_at)}</>}
              {p.stale && <strong className="text-danger"> — items changed, regenerate</strong>}
            </p>
          ) : (
            <p className="cell-sub">{allChecked ? 'Not generated yet.' : 'Check every item, then generate the Proforma Invoice.'}</p>
          )}
        </div>
        <div className="proforma-panel__actions">
          {p && (
            <>
              <a className="btn btn--ghost btn--sm" href={p.link} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> View / Print</a>
              {d.cash.is_cash && <Button size="sm" variant="ghost" icon={Link2} onClick={copy}>Copy link</Button>}
            </>
          )}
          {canEdit && (
            <Button size="sm" variant={p && !p.stale ? 'secondary' : 'primary'} icon={FileText} loading={busy === 'pf'} disabled={!!busy || !allChecked} onClick={generate}>
              {p ? 'Regenerate' : 'Generate Proforma'}
            </Button>
          )}
        </div>
      </div>

      {d.cash.is_cash && (
        <div className="proforma-panel__cash">
          <Badge variant="danger">Cash customer</Badge>
          <span className="cell-sub">Share the Proforma Invoice and take the advance before Picking.</span>

          {canEdit && p && !p.stale && (
            <>
              <div className="chip-select">
                {LEDGER_RECIPIENTS.map((r) => (
                  <button key={r.key} type="button" className={`chip-select__chip ${recipients.includes(r.key) ? 'is-on' : ''}`}
                    onClick={() => setRecipients((x) => (x.includes(r.key) ? x.filter((k) => k !== r.key) : [...x, r.key]))}>
                    {r.label}
                  </button>
                ))}
                <Button size="sm" icon={Send} loading={busy === 'share'} disabled={!!busy || !recipients.length} onClick={share}>Share on WhatsApp</Button>
              </div>
              {results && (
                <ul className="sync-history">
                  {results.map((r) => (
                    <li key={r.type}>
                      <span className="sync-history__what">{r.label} {r.to ? <span className="mono mono--plain">→ {r.to}</span> : ''}{r.status !== 'SENT' && <small> — {r.error || r.reason}</small>}</span>
                      <span className="sync-history__meta">{r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {d.advance ? (
            <p className="proforma-panel__advance">
              <Wallet size={14} /> Advance received <strong>{inr(d.advance.amount)}</strong> · Ref {d.advance.reference} · {stampFmt(d.advance.received_at)}
              {d.advance.received_by && ` by ${d.advance.received_by}`}
              {d.advance.remark && <> · {d.advance.remark}</>}
            </p>
          ) : canEdit ? (
            <div className="proforma-panel__form">
              <Input label="Advance amount (₹)" type="number" min="1" step="0.01" required value={adv.amount} onChange={(e) => setAdv((a) => ({ ...a, amount: e.target.value }))} />
              <Input label="Reference (UTR / cheque no.)" required maxLength={100} value={adv.reference} onChange={(e) => setAdv((a) => ({ ...a, reference: e.target.value }))} />
              <Input label="Remark" maxLength={500} value={adv.remark} onChange={(e) => setAdv((a) => ({ ...a, remark: e.target.value }))} />
              <Button icon={Wallet} loading={busy === 'adv'} disabled={!!busy || !(Number(adv.amount) > 0) || !adv.reference.trim()} onClick={saveAdvance}>
                Advance Received
              </Button>
            </div>
          ) : (
            <p className="cell-sub">Advance not received yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
