import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Link2, MapPinned } from 'lucide-react';
import { zonesApi, ZONES, resetZoneCache } from '../../api/zones';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select, Textarea } from '../../components/ui/FormControls';

const countPins = (text) => new Set(text.split(/[\s,;]+/).filter(Boolean)).size;

export default function ZoneMapping() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('route_planning', 'edit');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [zone, setZone] = useState('');

  const [bulk, setBulk] = useState(null); // { pincodes, zone, area_name, result }
  const [edit, setEdit] = useState(null); // row being edited
  const [toDelete, setToDelete] = useState(null);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await zonesApi.list({ search: search || undefined, zone: zone || undefined }));
    } catch (err) {
      toast.error('Could not load zone mapping', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, zone, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const changed = () => {
    resetZoneCache();
    load();
  };

  const runBulk = async () => {
    if (!bulk.zone) return setError('Select a zone');
    if (!countPins(bulk.pincodes)) return setError('Enter at least one PIN code');
    setBusy(true);
    setError('');
    try {
      const result = await zonesApi.bulk({ pincodes: bulk.pincodes, zone: bulk.zone, area_name: bulk.area_name });
      setBulk((b) => ({ ...b, result }));
      if (result.created.length) toast.success(`${result.created.length} PIN code(s) mapped to ${bulk.zone}`);
      changed();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!/^\d{6}$/.test(edit.pincode)) return setError('PIN code must be 6 digits');
    setBusy(true);
    setError('');
    try {
      await zonesApi.update(edit.id, { pincode: edit.pincode, area_name: edit.area_name, zone: edit.zone });
      toast.success('Mapping updated', `${edit.pincode} → ${edit.zone}`);
      setEdit(null);
      changed();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await zonesApi.remove(toDelete.id);
      toast.success('Mapping deleted', toDelete.pincode);
      setToDelete(null);
      changed();
    } catch (err) {
      toast.error('Could not delete', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const backfill = async () => {
    setBusy(true);
    try {
      const r = await zonesApi.backfill();
      toast.success(
        'Old entries connected',
        `Clients: ${r.clients.updated} of ${r.clients.candidates} matched and updated · Transports: ${r.transports.updated} of ${r.transports.candidates} matched and updated`,
        8000
      );
      setBackfillOpen(false);
    } catch (err) {
      toast.error('Could not connect old entries', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Zone Mapping</h2>
          <p className="page-header__sub">PIN code to delivery zone. Client Registration fills the Zone from this list.</p>
        </div>
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search PIN or area…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </label>
          <select className="toolbar__select" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
            <option value="">All zones</option>
            {ZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
          <div className="toolbar__end">
            <Badge variant="neutral">{rows.length} PIN code(s)</Badge>
            {manage && (
              <>
                <Button variant="secondary" icon={Link2} onClick={() => setBackfillOpen(true)}>
                  Connect Old Entries
                </Button>
                <Button icon={Plus} onClick={() => { setError(''); setBulk({ pincodes: '', zone: '', area_name: '', result: null }); }}>
                  Map PIN Codes
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <th>PIN Code</th>
                <th>Area</th>
                <th>Zone</th>
                {manage && <th className="num">Action</th>}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton width={70} /></td>
                      <td><Skeleton width={200} /></td>
                      <td><Skeleton width={80} /></td>
                      {manage && <td />}
                    </tr>
                  ))
                : rows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-main">{r.pincode}</td>
                      <td>{r.area_name || <span className="cell-sub">—</span>}</td>
                      <td><Badge size="sm" variant="info">{r.zone}</Badge></td>
                      {manage && (
                        <td className="num">
                          <div className="row-actions">
                            <button className="icon-btn icon-btn--sm" title="Edit" onClick={() => { setError(''); setEdit({ ...r, area_name: r.area_name || '' }); }}>
                              <Pencil size={15} />
                            </button>
                            <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" onClick={() => setToDelete(r)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><MapPinned size={22} /></span>
              <h2>{search || zone ? 'No matching PIN codes' : 'No PIN codes mapped yet'}</h2>
              <p>{manage ? 'Use “Map PIN Codes” to assign Surat PIN codes to zones.' : ''}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bulk map */}
      <Modal
        open={!!bulk}
        title="Map PIN Codes"
        subtitle="Paste many PIN codes — all are assigned to one zone"
        busy={busy}
        onClose={() => setBulk(null)}
        footer={
          bulk?.result ? (
            <Button onClick={() => setBulk(null)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setBulk(null)} disabled={busy}>Cancel</Button>
              <Button loading={busy} onClick={runBulk}>Map {bulk ? countPins(bulk.pincodes) || '' : ''} PIN Code(s)</Button>
            </>
          )
        }
      >
        {bulk && !bulk.result && (
          <div className="form-grid">
            <div className="form-grid__full">
              <Textarea
                label="PIN codes"
                required
                rows={5}
                value={bulk.pincodes}
                placeholder={'395001, 395002\n395006'}
                hint="Separate with commas, spaces or new lines."
                onChange={(e) => setBulk((b) => ({ ...b, pincodes: e.target.value }))}
              />
            </div>
            <Select label="Zone" required value={bulk.zone} onChange={(e) => setBulk((b) => ({ ...b, zone: e.target.value }))}>
              <option value="">— Select —</option>
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
            <Input label="Area name" value={bulk.area_name} maxLength={160} placeholder="Optional, shared by all" onChange={(e) => setBulk((b) => ({ ...b, area_name: e.target.value }))} />
            {error && <p className="sync-error form-grid__full">{error}</p>}
          </div>
        )}
        {bulk?.result && (
          <div className="sync-result">
            <div className="sync-stats">
              <div className="sync-stat"><span className="sync-stat__label">Mapped</span>{bulk.result.created.length ? <Badge variant="success">{bulk.result.created.length}</Badge> : <strong>0</strong>}</div>
              <div className="sync-stat"><span className="sync-stat__label">Already mapped</span>{bulk.result.conflicts.length ? <Badge variant="warning">{bulk.result.conflicts.length}</Badge> : <strong>0</strong>}</div>
              <div className="sync-stat"><span className="sync-stat__label">Invalid</span>{bulk.result.invalid.length ? <Badge variant="danger">{bulk.result.invalid.length}</Badge> : <strong>0</strong>}</div>
            </div>
            {bulk.result.conflicts.length > 0 && (
              <p className="form-note form-note--warn">
                Not changed (already mapped): {bulk.result.conflicts.map((c) => `${c.pincode} → ${c.zone}`).join(', ')}. Edit those rows to change their zone.
              </p>
            )}
            {bulk.result.invalid.length > 0 && <p className="field__hint">Invalid (need 6 digits): {bulk.result.invalid.join(', ')}</p>}
          </div>
        )}
      </Modal>

      {/* Edit one */}
      <Modal
        open={!!edit}
        size="sm"
        title="Edit mapping"
        busy={busy}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
            <Button loading={busy} onClick={saveEdit}>Save</Button>
          </>
        }
      >
        {edit && (
          <div className="form-grid form-grid--single">
            <Input label="PIN code" required inputMode="numeric" maxLength={6} value={edit.pincode} onChange={(e) => setEdit((x) => ({ ...x, pincode: e.target.value.replace(/\D/g, '') }))} />
            <Input label="Area name" maxLength={160} value={edit.area_name} onChange={(e) => setEdit((x) => ({ ...x, area_name: e.target.value }))} />
            <Select label="Zone" required value={edit.zone} onChange={(e) => setEdit((x) => ({ ...x, zone: e.target.value }))}>
              {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
            {error && <p className="sync-error">{error}</p>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        busy={busy}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Delete mapping?"
        message={`PIN ${toDelete?.pincode} will no longer map to ${toDelete?.zone}. Zones already saved on clients and transports are not changed.`}
      />

      <ConfirmDialog
        open={backfillOpen}
        busy={busy}
        tone="primary"
        confirmLabel="Connect"
        onClose={() => setBackfillOpen(false)}
        onConfirm={backfill}
        title="Connect old entries?"
        message="Clients and transports with a blank zone and a PIN code will get the zone mapped to that exact PIN. Records that already have a zone are not touched."
      />
    </div>
  );
}
