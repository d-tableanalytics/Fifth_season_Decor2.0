import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Loader';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Select, Textarea, Switch } from '../../components/ui/FormControls';

const api_ = {
  events: () => api.get('/whatsapp/events').then((r) => r.data.data),
  list: () => api.get('/whatsapp/templates').then((r) => r.data.data),
  create: (b) => api.post('/whatsapp/templates', b).then((r) => r.data),
  update: (id, b) => api.put(`/whatsapp/templates/${id}`, b).then((r) => r.data),
  remove: (id) => api.delete(`/whatsapp/templates/${id}`).then((r) => r.data),
  logs: (params) => api.get('/whatsapp/logs', { params }).then((r) => r.data.data),
};

// One realistic value per placeholder — used only for the live preview
const SAMPLE = {
  company_name: 'Heeramani Furnishing',
  enquiry_number: 'ENQ-0001',
  pending_invoices: '1. INV-101 · 02 Jan 2026 · ₹45,000 (12 days overdue)\n2. INV-109 · 10 Jan 2026 · ₹18,500',
  total_pending: '₹63,500',
  link: 'https://example.com/pay/abc123',
  link_valid_days: '7',
  proforma_no: 'PI_0001',
  amount: '₹1,25,000',
  order_no: 'ORD-0001',
  order_type: 'Cut',
  client_id: 'FSD1166',
  item_count: '5',
  transport_name: 'VRL Logistics',
  lr_number: 'LR123456',
  tracking_link: 'https://example.com/track/abc123',
};

const render = (body, vars, keepMissing) =>
  String(body || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => (vars[key] == null ? (keepMissing ? m : '') : String(vars[key])));

const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const blank = { id: null, name: '', event: '', body: '', description: '', enabled: true };

export function TemplatesTab({ manage }) {
  const toast = useToast();
  const [events, setEvents] = useState({});
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [ev, list] = await Promise.all([api_.events(), api_.list()]);
      setEvents(ev);
      setRows(list);
    } catch (err) {
      toast.error('Could not load templates', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const used = useMemo(() => new Set(rows.map((r) => r.event)), [rows]);
  const placeholders = events[editor?.event]?.placeholders || [];

  const insert = (key) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    const start = el?.selectionStart ?? editor.body.length;
    const end = el?.selectionEnd ?? editor.body.length;
    setEditor((e) => ({ ...e, body: e.body.slice(0, start) + token + e.body.slice(end) }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    if (!editor.name.trim()) return toast.error('Template name is required');
    if (!editor.event) return toast.error('Select a trigger event');
    if (!editor.body.trim()) return toast.error('Message body is required');
    setSaving(true);
    try {
      const payload = { name: editor.name, event: editor.event, body: editor.body, description: editor.description || null, enabled: editor.enabled };
      const r = editor.id ? await api_.update(editor.id, payload) : await api_.create(payload);
      toast.success(r.message);
      setEditor(null);
      load();
    } catch (err) {
      toast.error('Could not save template', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t) => {
    try {
      await api_.update(t.id, { enabled: !t.enabled });
      setRows((rs) => rs.map((r) => (r.id === t.id ? { ...r, enabled: !t.enabled } : r)));
    } catch (err) {
      toast.error('Could not update template', getErrorMessage(err));
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api_.remove(toDelete.id);
      toast.success('Template deleted');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not delete template', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card--flush">
      <div className="toolbar">
        <p className="page-header__sub">When an event has an enabled template, its message is sent instead of the built-in text.</p>
        {manage && (
          <Button icon={Plus} onClick={() => setEditor({ ...blank })}>
            New Template
          </Button>
        )}
      </div>

      <div className="table-wrap table-wrap--flush">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Event</th>
              <th>Message</th>
              <th>Enabled</th>
              {manage && <th className="num">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  <td><Skeleton width={160} /></td><td><Skeleton width={140} /></td><td><Skeleton width={260} /></td><td><Skeleton width={50} /></td>{manage && <td />}
                </tr>
              ))
            ) : (
              rows.map((t) => (
                <tr key={t.id}>
                  <td className="cell-wrap">
                    <p className="cell-main">{t.name}</p>
                    {t.description && <p className="cell-sub">{t.description}</p>}
                  </td>
                  <td><Badge variant="info">{events[t.event]?.label || t.event}</Badge></td>
                  <td className="cell-wrap" title={t.body}>{t.body.length > 90 ? `${t.body.slice(0, 90)}…` : t.body}</td>
                  <td>
                    {manage ? (
                      <button type="button" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => toggle(t)} aria-label={`Toggle ${t.name}`}>
                        <Badge variant={t.enabled ? 'success' : 'neutral'}>{t.enabled ? 'ON' : 'OFF'}</Badge>
                      </button>
                    ) : (
                      <Badge variant={t.enabled ? 'success' : 'neutral'}>{t.enabled ? 'ON' : 'OFF'}</Badge>
                    )}
                  </td>
                  {manage && (
                    <td className="num">
                      <div className="row-actions">
                        <button className="icon-btn icon-btn--sm" title="Edit" onClick={() => setEditor({ ...blank, ...t, description: t.description || '' })}>
                          <Pencil size={15} />
                        </button>
                        <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" onClick={() => setToDelete(t)}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="empty empty--inline">
            <h2>No templates yet</h2>
            <p>The built-in messages are being used.</p>
          </div>
        )}
      </div>

      <Modal
        open={!!editor}
        title={editor?.id ? 'Edit Template' : 'New Template'}
        size="lg"
        busy={saving}
        onClose={() => setEditor(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>Save</Button>
          </>
        }
      >
        {editor && (
          <div className="form-grid form-grid--single">
            <Input label="Template Name" required value={editor.name} maxLength={150} onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
            <Select label="Trigger Event" required value={editor.event} onChange={(e) => setEditor({ ...editor, event: e.target.value })}>
              <option value="">Select event…</option>
              {Object.entries(events).map(([key, ev]) => (
                <option key={key} value={key} disabled={used.has(key) && key !== rows.find((r) => r.id === editor.id)?.event}>
                  {ev.label}{used.has(key) && key !== rows.find((r) => r.id === editor.id)?.event ? ' (has template)' : ''}
                </option>
              ))}
            </Select>
            <Input label="Description" value={editor.description} maxLength={500} onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
            {placeholders.length > 0 && (
              <div>
                <p className="cell-sub">Insert placeholder</p>
                <div className="chip-select">
                  {placeholders.map((k) => (
                    <button key={k} type="button" className="chip-select__chip" onClick={() => insert(k)}>{`{{${k}}}`}</button>
                  ))}
                </div>
              </div>
            )}
            <Textarea
              ref={bodyRef}
              label="Message Body"
              required
              rows={6}
              value={editor.body}
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
              hint="WhatsApp formatting works: *bold*, _italic_, ~strike~"
            />
            <div>
              <p className="cell-sub">Live preview</p>
              <pre className="wa-preview" style={{ whiteSpace: 'pre-wrap', background: '#dcf8c6', padding: 12, borderRadius: 8, margin: 0, font: 'inherit' }}>
                {render(editor.body, SAMPLE, true) || '—'}
              </pre>
            </div>
            <Switch checked={editor.enabled} onChange={(v) => setEditor({ ...editor, enabled: v })} label="Enabled" />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete template"
        message={`Delete "${toDelete?.name}"? The built-in message will be used for this event again.`}
        busy={saving}
        onConfirm={remove}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}

export function HistoryTab() {
  const toast = useToast();
  const [events, setEvents] = useState({});
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText, 350);
  const [status, setStatus] = useState('');
  const [event, setEvent] = useState('');

  useEffect(() => {
    api_.events().then(setEvents).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api_
      .logs({ search: search || undefined, status: status || undefined, event: event || undefined, limit: 200 })
      .then(setRows)
      .catch((err) => toast.error('Could not load history', getErrorMessage(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, event]);

  return (
    <div className="card card--flush">
      <div className="toolbar">
        <label className="toolbar__search">
          <Search size={15} />
          <input type="search" placeholder="Search number, client or message…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </label>
        <select className="toolbar__select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
        </select>
        <select className="toolbar__select" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
          <option value="">All events</option>
          {Object.entries(events).map(([k, ev]) => <option key={k} value={k}>{ev.label}</option>)}
          <option value="TEST">Test send</option>
        </select>
      </div>
      <p className="cell-sub">Sent = accepted by Maytapi; delivery / read status is not tracked.</p>

      <div className="table-wrap table-wrap--flush">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Event</th><th>To</th><th>Message</th><th>By</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}><td><Skeleton width={110} /></td><td><Skeleton width={120} /></td><td><Skeleton width={140} /></td><td><Skeleton width={240} /></td><td><Skeleton width={80} /></td><td><Skeleton width={50} /></td></tr>
              ))
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td>{stamp(m.created_at)}</td>
                  <td>{events[m.trigger_key]?.label || m.trigger_key}</td>
                  <td className="cell-wrap">
                    <p className="cell-main">{m.company_name || m.recipient_type}</p>
                    <p className="cell-sub mono mono--plain">{m.to_number}</p>
                  </td>
                  <td className="cell-wrap" title={m.message}>{m.message.length > 100 ? `${m.message.slice(0, 100)}…` : m.message}</td>
                  <td>{m.sent_by_name || '—'}</td>
                  <td><span title={m.error || ''}><Badge variant={m.status === 'SENT' ? 'success' : 'danger'}>{m.status}</Badge></span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="empty empty--inline">
            <h2>No messages found</h2>
          </div>
        )}
      </div>
    </div>
  );
}
