import { useCallback, useEffect, useState } from 'react';
import { CutOrderModal } from './CutOrderForm';
import { Plus, Search, Pencil, Trash2, Ban, RotateCcw, Play, Repeat, ClipboardList, PackageCheck, Scissors, FileCheck2, Package } from 'lucide-react';
import { PickingQueue } from './PickingQueue';
import { CuttingQueue } from './CuttingQueue';
import { DeliveryNoteQueue } from './DeliveryNoteQueue';
import { PackingQueue } from './PackingQueue';
import { ORDER_MODES, STAGE_LABELS, PICKING_OR_LATER } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { useO2D } from '../../context/O2DContext';

const LIST_TABS = [
  { key: 'active', label: 'Orders' },
  { key: 'hold', label: 'On Hold' },
  { key: 'cancelled', label: 'Cancelled Orders' },
];
const MODE_LABEL = Object.fromEntries(ORDER_MODES.map((m) => [m.key, m.label]));
const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const orderNo = (o) => o.system_order_no || o.enquiry_number;

export default function CutOrders() {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const [orderModal, setOrderModal] = useState(null); // { id, mode } — id null = new
  const perms = {
    create: can(o2d.perm, 'create'),
    edit: can(o2d.perm, 'edit'),
    delete: can(o2d.perm, 'delete'),
    convert: o2d.type === 'CUT' && can(o2d.perm, 'edit') && can('o2d_roll', 'create'), // Cut -> Roll only
  };

  const [stage, setStage] = useState('enquiry');
  const [tab, setTab] = useState('active');
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null); // { kind, order }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await o2d.apis.orders.list({ tab, page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load orders', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const isHoldTab = tab === 'hold';

  const CONFIRM = {
    cancel: { title: 'Cancel order?', label: 'Cancel Order', tone: 'danger', msg: (o) => `Order ${orderNo(o)} will be marked as cancelled. This cannot be undone.` },
    reactivate: { title: 'Reactivate order?', label: 'Reactivate', tone: 'primary', msg: (o) => `Order ${orderNo(o)} will restart from the very first stage of the O2D workflow.` },
    resume: { title: 'Resume order?', label: 'Resume', tone: 'primary', msg: (o) => `Order ${orderNo(o)} will go back to ${STAGE_LABELS[o.held_from] || 'the stage it was held from'}.` },
    convert: { title: 'Convert to Roll order?', label: 'Convert', tone: 'primary', msg: (o) => `Order ${orderNo(o)} will move to Roll orders with the same items and details.` },
    delete: {
      title: 'Delete order permanently?',
      label: 'Delete',
      tone: 'danger',
      msg: (o) =>
        o.workflow_status !== 'DRAFT'
          ? `Order ${orderNo(o)} has already moved past Draft. Deleting removes the order and its entire history permanently — unlike Cancel, nothing is kept.`
          : `Order ${orderNo(o)} will be permanently deleted.`,
    },
  };

  const run = async () => {
    const { kind, order } = confirm;
    setBusy(true);
    try {
      if (kind === 'delete') await o2d.apis.orders.remove(order.id);
      else await o2d.apis.orders.action(order.id, kind === 'convert' ? 'convert-to-roll' : kind);
      toast.success(`${CONFIRM[kind].label} done`, `Order ${orderNo(order)}`);
      setConfirm(null);
      load();
    } catch (err) {
      toast.error(`Could not ${CONFIRM[kind].label.toLowerCase()}`, getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const actionsFor = (o) => {
    const cancelled = o.status === 'CANCELLED';
    const stage = o.workflow_status === 'ON_HOLD' ? o.held_from : o.workflow_status;
    const list = [];
    if (perms.convert && !cancelled && !PICKING_OR_LATER.has(stage)) list.push({ kind: 'convert', icon: Repeat, title: 'Convert to Roll Order' });
    if (perms.edit && o.workflow_status === 'ON_HOLD') list.push({ kind: 'resume', icon: Play, title: 'Resume', cls: 'icon-btn--ok' });
    if (perms.edit && !cancelled) list.push({ kind: 'edit', icon: Pencil, title: 'Edit' });
    if (perms.edit && !cancelled) list.push({ kind: 'cancel', icon: Ban, title: 'Cancel Order', cls: 'icon-btn--warn' });
    if (perms.edit && cancelled) list.push({ kind: 'reactivate', icon: RotateCcw, title: 'Reactivate', cls: 'icon-btn--ok' });
    if (perms.delete) list.push({ kind: 'delete', icon: Trash2, title: 'Delete', cls: 'icon-btn--danger' });
    return list;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">{o2d.label} Orders</h2>
          <p className="page-header__sub">O2D › {o2d.label}</p>
        </div>
        {perms.create && (
          <Button icon={Plus} onClick={() => setOrderModal({ id: null, mode: 'edit' })}>
            New Order Enquiry
          </Button>
        )}
      </div>

      {/* Workflow stages — more stages are added step by step */}
      <div className="stage-tabs" role="tablist" aria-label="Workflow stage">
        <button role="tab" aria-selected={stage === 'enquiry'} className={`stage-tab ${stage === 'enquiry' ? 'is-active' : ''}`} onClick={() => setStage('enquiry')}>
          <ClipboardList size={15} /> Order Enquiry
        </button>
        {can('picking') && (
          <button role="tab" aria-selected={stage === 'picking'} className={`stage-tab ${stage === 'picking' ? 'is-active' : ''}`} onClick={() => setStage('picking')}>
            <PackageCheck size={15} /> Picking
          </button>
        )}
        <button role="tab" aria-selected={stage === 'cutting'} className={`stage-tab ${stage === 'cutting' ? 'is-active' : ''}`} onClick={() => setStage('cutting')}>
          <Scissors size={15} /> Cutting
        </button>
        <button role="tab" aria-selected={stage === 'dn'} className={`stage-tab ${stage === 'dn' ? 'is-active' : ''}`} onClick={() => setStage('dn')}>
          <FileCheck2 size={15} /> Delivery Note
        </button>
        <button role="tab" aria-selected={stage === 'packing'} className={`stage-tab ${stage === 'packing' ? 'is-active' : ''}`} onClick={() => setStage('packing')}>
          <Package size={15} /> Packing
        </button>
      </div>

      {stage === 'picking' ? <PickingQueue /> : stage === 'cutting' ? <CuttingQueue /> : stage === 'dn' ? <DeliveryNoteQueue /> : stage === 'packing' ? <PackingQueue /> : <>
      <div className="card card--flush">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Orders">
            {LIST_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'is-active' : ''}
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
              >
                {t.label}
                <span className="segmented__count">{result.counts?.[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="toolbar__search">
            <Search size={15} />
            <input
              type="search"
              placeholder="Search order no. or client reference…"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <th>{isHoldTab ? 'Held At' : 'Timestamp'}</th>
                <th>Order No</th>
                <th>Client ID</th>
                <th>Client</th>
                <th>Order Mode</th>
                <th>Transporter</th>
                <th>{isHoldTab ? 'Held From' : 'Stage'}</th>
                {isHoldTab && <th>Reason</th>}
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: isHoldTab ? 9 : 8 }).map((__, j) => (
                        <td key={j}><Skeleton width={j === 3 ? 180 : 80} /></td>
                      ))}
                    </tr>
                  ))
                : result.data.map((o) => (
                    <tr key={o.id} onClick={() => setOrderModal({ id: o.id, mode: 'view' })}>
                      <td className="cell-sub">{dateFmt(isHoldTab ? o.held_at : o.created_at)}</td>
                      <td className="mono">{orderNo(o)}</td>
                      <td className="mono mono--plain">{o.client_id}</td>
                      <td className="cell-wrap cell-main">{o.company_name}</td>
                      <td>
                        <Badge size="sm" variant={o.order_mode === 'THIRD_PARTY' ? 'warning' : o.order_mode === 'ONLINE' ? 'info' : 'neutral'}>
                          {MODE_LABEL[o.order_mode]}
                        </Badge>
                      </td>
                      <td>{o.transport_name || <span className="cell-sub">—</span>}</td>
                      <td>
                        <Badge size="sm" variant={o.status === 'CANCELLED' ? 'danger' : isHoldTab ? 'warning' : 'brand'}>
                          {STAGE_LABELS[isHoldTab ? o.held_from : o.workflow_status] || o.workflow_status}
                        </Badge>
                      </td>
                      {isHoldTab && <td className="cell-wrap">{o.hold_reason || '—'}</td>}
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {actionsFor(o).map(({ kind, icon: Icon, title, cls = '' }) => (
                            <button
                              key={kind}
                              className={`icon-btn icon-btn--sm ${cls}`}
                              title={title}
                              aria-label={title}
                              onClick={() => (kind === 'edit' ? setOrderModal({ id: o.id, mode: 'edit' }) : setConfirm({ kind, order: o }))}
                            >
                              <Icon size={15} />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><ClipboardList size={22} /></span>
              <h2>{search ? 'No matching orders' : tab === 'active' ? 'No orders yet' : tab === 'hold' ? 'No orders on hold' : 'No cancelled orders'}</h2>
              <p>{search ? 'Try a different order no. or client reference.' : tab === 'active' && perms.create ? 'Create the first order enquiry.' : ''}</p>
            </div>
          )}
        </div>

        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>
      </>}

      <ConfirmDialog
        open={!!confirm}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={run}
        tone={confirm ? CONFIRM[confirm.kind].tone : 'danger'}
        title={confirm ? CONFIRM[confirm.kind].title : ''}
        confirmLabel={confirm ? CONFIRM[confirm.kind].label : ''}
        message={confirm ? CONFIRM[confirm.kind].msg(confirm.order) : ''}
      />

      {orderModal && (
        <CutOrderModal
          key={`${orderModal.id}-${orderModal.mode}`}
          id={orderModal.id}
          mode={orderModal.mode}
          onClose={() => setOrderModal(null)}
          onSaved={() => {
            setOrderModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}
