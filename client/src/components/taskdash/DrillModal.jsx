import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tasksApi } from '../../api/tasks';
import { getErrorMessage } from '../../api/client';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Loader';
import { CLASS_LABELS, fmtDT, taskLink } from './common';

/** Drill-down (spec 15.4 #9): tasks behind a number. drill = { metric, title } | null */
export function DrillModal({ drill, filters, onClose }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!drill) return;
    setRows(null);
    setErr('');
    tasksApi.reportItems({ ...filters, metric: drill.metric }).then((r) => setRows(r.data)).catch((e) => setErr(getErrorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill]);

  return (
    <Modal open={!!drill} title={drill?.title} subtitle={drill ? `${rows ? rows.length : '…'} task(s), newest due first (max 200)` : ''} size="lg" onClose={onClose}>
      {err && <p className="field__error">{err}</p>}
      {!rows && !err && <Skeleton height={120} />}
      {rows && !rows.length && <p className="td-empty">No tasks.</p>}
      {rows && rows.length > 0 && (
        <div className="td-scroll">
          <table className="table td-table-sm">
            <thead><tr><th>Task</th><th>Doer</th><th>Due</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}${r.task_id}${r.occ_id || ''}`} className="td-row-click" onClick={() => { onClose(); navigate(taskLink(r.open)); }}>
                  <td>{r.title}<br /><span className="td-sub">{r.kind === 'd' ? 'Delegation' : 'Checklist'}{r.category ? ` · ${r.category}` : ''}</span></td>
                  <td>{r.doer}</td>
                  <td>{fmtDT(r.due_at, true)}</td>
                  <td>
                    <span className={`td-chip td-chip--${r.cls}`}>{r.label || CLASS_LABELS[r.cls]}</span>
                    {r.cls === 'overdue' && r.days > 0 && <span className="td-sub"> {r.days} Day{r.days === 1 ? '' : 's'} Overdue</span>}
                    {r.cls === 'late' && r.days > 0 && <span className="td-sub"> · {r.days}d</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
