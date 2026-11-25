import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Star, Copy, Tags } from 'lucide-react';
import { labelsApi, STAGE_LABEL } from '../../api/labels';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { ConfirmDialog } from '../../components/ui/Modal';

const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** Masters › Label Design: label templates per print stage. */
export default function LabelDesigns() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [stage, setStage] = useState('CUT_ITEM');
  const [rows, setRows] = useState([]);
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await labelsApi.list();
      setAll(list);
      setRows(list.filter((r) => r.stage === stage));
    } catch (err) {
      toast.error('Could not load label templates', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [stage, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(ok || r?.message || 'Done');
      setConfirm(null);
      load();
    } catch (err) {
      toast.error('Something went wrong', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = (r) =>
    act(async () => {
      const t = await labelsApi.get(r.id);
      const { id, is_default, updated_at, ...body } = t;
      await labelsApi.create({ ...body, name: `${t.name} (copy)`.slice(0, 120) });
    }, 'Template duplicated');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Label Design</h2>
          <p className="page-header__sub">Masters › Label templates for Cut Item, Leftover Fabric and Packing</p>
        </div>
        {can('label_design', 'create') && (
          <Button icon={Plus} onClick={() => navigate(`/masters/labels/new?stage=${stage}`)}>New Label</Button>
        )}
      </div>

      <div className="stage-tabs" role="tablist" aria-label="Label stage">
        {Object.entries(STAGE_LABEL).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={stage === k} className={`stage-tab ${stage === k ? 'is-active' : ''}`} onClick={() => setStage(k)}>
            <Tags size={15} /> {v} <span className="segmented__count">{all.filter((r) => r.stage === k).length}</span>
          </button>
        ))}
      </div>

      <div className="card card--flush">
        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr><th>Name</th><th>Size</th><th>Default</th><th>Last updated</th><th className="num">Actions</th></tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><Skeleton width={j === 0 ? 160 : 70} /></td>)}</tr>)
                : rows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/masters/labels/${r.id}`)}>
                      <td className="cell-main">{r.name}</td>
                      <td>{r.width_mm} × {r.height_mm} mm</td>
                      <td>{r.is_default ? <Badge size="sm" variant="success">Default</Badge> : <span className="cell-sub">—</span>}</td>
                      <td className="cell-sub">{stamp(r.updated_at)}{r.updated_by && ` · ${r.updated_by}`}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          {can('label_design', 'edit') && !r.is_default && (
                            <button className="icon-btn icon-btn--sm" title="Make default for this stage" onClick={() => act(() => labelsApi.makeDefault(r.id))}><Star size={15} /></button>
                          )}
                          <button className="icon-btn icon-btn--sm" title={can('label_design', 'edit') ? 'Edit design' : 'View design'} onClick={() => navigate(`/masters/labels/${r.id}`)}><Pencil size={15} /></button>
                          {can('label_design', 'create') && <button className="icon-btn icon-btn--sm" title="Duplicate" onClick={() => duplicate(r)}><Copy size={15} /></button>}
                          {can('label_design', 'delete') && (
                            <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" onClick={() => setConfirm(r)}><Trash2 size={15} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><Tags size={22} /></span>
              <h2>No {STAGE_LABEL[stage]} labels yet</h2>
              <p>{can('label_design', 'create') ? 'Design the first label for this stage.' : ''}</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => act(() => labelsApi.remove(confirm.id))}
        title="Delete label template?"
        confirmLabel="Delete"
        message={confirm ? `"${confirm.name}" will be deleted permanently.${confirm.is_default ? ' It is the default for this stage — choose another default afterwards.' : ''}` : ''}
      />
    </div>
  );
}
