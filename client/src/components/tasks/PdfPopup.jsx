import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../../context/ToastContext';
import { tasksApi, saveBlob } from '../../api/tasks';
import { todayStr, errMsg } from './taskUi';

/** "Generate PDF" popup of the Checklists tab (spec 14). filters = the list filters; who = name text. */
export function PdfPopup({ open, onClose, filters, meId, who, filtered }) {
  const toast = useToast();
  const [from, setFrom] = useState(`${todayStr().slice(0, 8)}01`);
  const [to, setTo] = useState(todayStr());
  const [busy, setBusy] = useState('');

  const run = async (key, fn) => {
    setBusy(key);
    try { saveBlob(await fn()); onClose(); } catch (e) {
      let m = errMsg(e);
      if (e?.response?.data instanceof Blob) { try { m = JSON.parse(await e.response.data.text()).message || m; } catch { /* keep */ } }
      toast.error('Could not make the PDF', m);
    } finally { setBusy(''); }
  };

  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
  return (
    <Modal open={open} size="sm" title="Generate PDF" onClose={onClose} busy={!!busy}>
      <div className="tk-pdf">
        <p className="tk-muted">For: <strong>{who}</strong>{filtered ? ' · with the filters of the list' : ''}</p>
        <div className="tk-box">
          <strong>Task PDF</strong>
          <p className="tk-muted">Checklist tasks, one table per doer.</p>
          <Button loading={busy === 'tasks'} onClick={() => run('tasks', () => tasksApi.checklistPdf(clean({ ...filters, limit: undefined, page: undefined })))}>Download task PDF</Button>
        </div>
        <div className="tk-box">
          <strong>Scoring PDF</strong>
          <div className="tk-grid2">
            <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button loading={busy === 'score'} onClick={() => run('score', () => tasksApi.scorePdf(clean({
            from, to, doer: filters.assignee || (filters.scope === 'mine' ? meId : ''), category: filters.category, search: filters.search,
          })))}>Download scoring PDF</Button>
        </div>
      </div>
    </Modal>
  );
}
