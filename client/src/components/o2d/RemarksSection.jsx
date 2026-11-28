import { useCallback, useEffect, useState } from 'react';
import { MessageSquareText, Plus } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { STAGE_LABELS } from '../../api/o2d';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ActivityLog } from './ActivityLog';

const REMARK_MODULES = ['o2d_cut', 'o2d_roll', 'crm_payment_check', 'crm_stock_check', 'crm_manager_approval', 'picking', 'planning_dispatch', 'dispatch_pending'];
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Remarks of an order across all stages (stage name, who, when). A remark added here is tagged with the
 * order's current stage and shows on every later stage's view.
 */
export function RemarksSection({ orderId, readOnly = false }) {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdd = !readOnly && (can(REMARK_MODULES, 'edit') || can('crm_manager_approval', 'approve'));

  const load = useCallback(
    () => api.get(`/o2d/orders/${orderId}/remarks`).then((r) => setRows(r.data.data)).catch(() => setRows([])),
    [orderId]
  );
  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/o2d/orders/${orderId}/remarks`, { remark: text.trim() });
      setRows(r.data.data);
      setText('');
      toast.success(r.data.message);
    } catch (err) {
      toast.error('Could not add remark', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="remarks">
      <h4 className="crm-pay__title"><MessageSquareText size={14} /> Remarks {rows?.length ? <span className="cell-sub">({rows.length})</span> : null}</h4>
      {canAdd && (
        <div className="remarks__add">
          <textarea rows={2} maxLength={1000} value={text} placeholder="Add a remark for the next stages…" onChange={(e) => setText(e.target.value)} />
          <Button size="sm" icon={Plus} loading={busy} disabled={busy || !text.trim()} onClick={add}>Add</Button>
        </div>
      )}
      {rows == null ? (
        <p className="cell-sub">Loading…</p>
      ) : rows.length ? (
        <ul className="remarks__list">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="remarks__meta">
                <Badge size="sm" variant="brand">{STAGE_LABELS[r.stage] || r.stage || '—'}</Badge>
                <span className="remarks__kind">{r.kind}</span>
                <span className="cell-sub">{r.by || '—'} · {stamp(r.at)}</span>
              </div>
              <p>{r.remark}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cell-sub">No remarks yet.</p>
      )}
      <ActivityLog orderId={orderId} />
    </section>
  );
}
