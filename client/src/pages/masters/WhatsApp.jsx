import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, Link2, Unlink, Wand2, Send, CheckCircle2, XCircle, MessageCircle, Users } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, Spinner } from '../../components/ui/Loader';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { Select, Textarea, Pagination } from '../../components/ui/FormControls';
import { AsyncPicker } from '../../components/forms/AsyncPicker';

const wa = {
  status: () => api.get('/whatsapp/status').then((r) => r.data.data),
  groups: (params) => api.get('/whatsapp/groups', { params }).then((r) => r.data),
  sync: () => api.post('/whatsapp/groups/sync').then((r) => r.data.data),
  syncStatus: () => api.get('/whatsapp/groups/sync/status').then((r) => r.data.data),
  link: (groupId, body) => api.put(`/whatsapp/groups/${encodeURIComponent(groupId)}/link`, body).then((r) => r.data),
  unlink: (groupId) => api.delete(`/whatsapp/groups/${encodeURIComponent(groupId)}/link`).then((r) => r.data),
  linkSuggested: () => api.post('/whatsapp/groups/link-suggested').then((r) => r.data.data),
  clients: (search) => api.get('/whatsapp/lookups/clients', { params: { search } }).then((r) => r.data.data),
  recipients: () => api.get('/whatsapp/recipients').then((r) => r.data.data),
  settings: () => api.get('/whatsapp/settings').then((r) => r.data.data),
  saveSettings: (body) => api.put('/whatsapp/settings', body).then((r) => r.data),
  test: (body) => api.post('/whatsapp/test', body, { timeout: 120_000 }).then((r) => r.data.data),
};

const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function WhatsApp() {
  const { can } = useAuth();
  const manage = can('whatsapp', 'edit');
  const [tab, setTab] = useState('groups');
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);

  useEffect(() => {
    wa.status().then(setStatus).catch((err) => setStatusErr(getErrorMessage(err)));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">WhatsApp Integration</h2>
          <p className="page-header__sub">Maytapi — connect client WhatsApp groups and choose who messages go to.</p>
        </div>
        <div className="wa-status">
          {statusErr ? (
            <Badge variant="danger"><XCircle size={12} /> {statusErr}</Badge>
          ) : !status ? (
            <Spinner size={14} />
          ) : (
            <Badge variant={status.connected && status.canSend ? 'success' : 'danger'} dot>
              {status.connected ? `Connected${status.number ? ` · ${status.number}` : ''}` : `Not connected (${status.state || 'unknown'})`}
            </Badge>
          )}
        </div>
      </div>

      <div className="stage-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'groups'} className={`stage-tab ${tab === 'groups' ? 'is-active' : ''}`} onClick={() => setTab('groups')}>
          <Users size={15} /> Groups
        </button>
        <button role="tab" aria-selected={tab === 'settings'} className={`stage-tab ${tab === 'settings' ? 'is-active' : ''}`} onClick={() => setTab('settings')}>
          <MessageCircle size={15} /> Recipients &amp; Test
        </button>
      </div>

      {tab === 'groups' ? <GroupsTab manage={manage} /> : <SettingsTab manage={manage} />}
    </div>
  );
}

function GroupsTab({ manage }) {
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [link, setLink] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, summary: null });
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null); // background group fetch
  const [linking, setLinking] = useState(null); // { group, client, conflict }
  const [unlinkGroup, setUnlinkGroup] = useState(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await wa.groups({ page, limit: 25, search: search || undefined, link: link || undefined }));
    } catch (err) {
      toast.error('Could not load groups', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, link, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Group fetch runs on the server in the background; poll its progress
  const pollRef = useRef(null);
  const watch = useCallback(() => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await wa.syncStatus();
        setJob(j);
        if (!j.running) {
          clearInterval(pollRef.current);
          if (j.error) toast.error('Could not fetch all groups', `${j.error}${j.fetched ? ` — ${j.fetched} groups were saved before it stopped.` : ''}`, 10000);
          else if (j.result) toast.success('Groups fetched from Maytapi', `${j.result.fetched} groups · ${j.result.new} new · ${j.result.linked} linked to clients`, 7000);
          load();
        } else if (j.fetched) load();
      } catch {
        /* keep polling */
      }
    }, 3000);
  }, [load, toast]);

  useEffect(() => {
    wa.syncStatus().then((j) => {
      setJob(j);
      if (j.running) watch();
    }).catch(() => {});
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchGroups = async () => {
    try {
      setJob(await wa.sync());
      watch();
    } catch (err) {
      toast.error('Could not start fetching groups', getErrorMessage(err));
    }
  };
  const syncing = !!job?.running;

  const doLink = async (force = false) => {
    setBusy(true);
    try {
      await wa.link(linking.group.group_id, { client_ref: linking.client.id, force });
      toast.success('Group linked', `${linking.client.client_id} · ${linking.client.company_name}`);
      setLinking(null);
      load();
    } catch (err) {
      if (err.response?.data?.code === 'GROUP_ALREADY_LINKED') setLinking((l) => ({ ...l, conflict: err.response.data.linkedTo }));
      else toast.error('Could not link group', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const quickLink = async (g) => {
    try {
      await wa.link(g.group_id, { client_ref: g.suggested_ref });
      toast.success('Group linked', `${g.suggested_client_id} · ${g.suggested_company}`);
      load();
    } catch (err) {
      toast.error('Could not link group', getErrorMessage(err));
    }
  };

  const doUnlink = async () => {
    setBusy(true);
    try {
      await wa.unlink(unlinkGroup.group_id);
      toast.success('Group unlinked');
      setUnlinkGroup(null);
      load();
    } catch (err) {
      toast.error('Could not unlink', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const linkSuggested = async () => {
    setBusy(true);
    try {
      const r = await wa.linkSuggested();
      toast.success('Suggested groups linked', `${r.linked} client(s) linked`);
      setSuggestOpen(false);
      load();
    } catch (err) {
      toast.error('Could not link', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const s = result.summary;
  return (
    <>
      <div className="stock-tiles">
        {[
          { label: 'Groups in Maytapi', value: s?.groups, sub: s?.last_fetched ? `Fetched ${stamp(s.last_fetched)}` : 'Not fetched yet' },
          { label: 'Linked to clients', value: s?.linked, sub: 'Via client WhatsApp group ID' },
          { label: 'Not linked', value: s ? s.groups - s.linked : null, sub: 'Groups without a client' },
          { label: 'Client group ID not in Maytapi', value: s?.clients_unknown_group, sub: 'Saved on client, but not found' },
        ].map((t) => (
          <div key={t.label} className="stock-tile stock-tile--static">
            <span className="stock-tile__body">
              <span className="stock-tile__label">{t.label}</span>
              {t.value == null ? <Skeleton width={60} height={20} /> : <span className="stock-tile__value">{t.value.toLocaleString('en-IN')}</span>}
              <span className="stock-tile__sub">{t.sub}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search group name, group ID or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
          <select className="toolbar__select" value={link} onChange={(e) => { setLink(e.target.value); setPage(1); }} aria-label="Link status">
            <option value="">All groups</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Not linked</option>
            <option value="suggested">Not linked — suggestion available</option>
          </select>
          {manage && (
            <div className="toolbar__end">
              <Button variant="secondary" icon={Wand2} onClick={() => setSuggestOpen(true)}>Link Suggested</Button>
              <Button icon={RefreshCw} loading={syncing} onClick={fetchGroups}>{syncing ? `Fetching… page ${job.page} · ${job.fetched} groups` : 'Fetch Groups from Maytapi'}</Button>
            </div>
          )}
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Group</th>
                <th className="num">Members</th>
                <th>Linked client</th>
                {manage && <th className="num">Action</th>}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td><Skeleton width={260} /></td><td><Skeleton width={30} /></td><td><Skeleton width={180} /></td>{manage && <td />}
                    </tr>
                  ))
                : result.data.map((g) => (
                    <tr key={g.group_id}>
                      <td className="cell-wrap">
                        <p className="cell-main">{g.name || '—'}</p>
                        <p className="cell-sub mono mono--plain">{g.group_id}</p>
                      </td>
                      <td className="num">{g.participants ?? '—'}</td>
                      <td>
                        {g.client_ref ? (
                          <>
                            <p><span className="mono">{g.client_id}</span> {g.company_name}</p>
                            {g.linked_count > 1 && <p className="cell-sub">+{g.linked_count - 1} more client(s) share this group</p>}
                          </>
                        ) : g.suggested_ref ? (
                          <p className="cell-sub">
                            Suggested: <span className="mono">{g.suggested_client_id}</span> {g.suggested_company}
                          </p>
                        ) : (
                          <Badge size="sm" variant="neutral">Not linked</Badge>
                        )}
                      </td>
                      {manage && (
                        <td className="num">
                          <div className="row-actions">
                            {!g.client_ref && g.suggested_ref && (
                              <Button size="sm" variant="ghost" icon={Wand2} onClick={() => quickLink(g)}>Link {g.suggested_client_id}</Button>
                            )}
                            <button className="icon-btn icon-btn--sm" title="Link to a client" onClick={() => setLinking({ group: g, client: null, conflict: null })}>
                              <Link2 size={15} />
                            </button>
                            {g.client_ref && (
                              <button className="icon-btn icon-btn--sm icon-btn--danger" title="Unlink" onClick={() => setUnlinkGroup(g)}>
                                <Unlink size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><Users size={22} /></span>
              <h2>{s?.groups ? 'No matching groups' : 'No groups yet'}</h2>
              <p>{s?.groups ? 'Try a different search or filter.' : manage ? 'Click “Fetch Groups from Maytapi”.' : ''}</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      <Modal
        open={!!linking}
        size="md"
        title="Link group to client"
        subtitle={linking?.group.name}
        busy={busy}
        onClose={() => setLinking(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinking(null)} disabled={busy}>Cancel</Button>
            {linking?.conflict ? (
              <Button variant="danger" loading={busy} onClick={() => doLink(true)}>Move to this client</Button>
            ) : (
              <Button loading={busy} disabled={!linking?.client} onClick={() => doLink(false)}>Link</Button>
            )}
          </>
        }
      >
        {linking && (
          <div className="form-grid form-grid--single">
            <div className="field">
              <span className="field__label">Client<span className="field__req"> *</span></span>
              <AsyncPicker
                text={linking.client ? `${linking.client.client_id} · ${linking.client.company_name}` : ''}
                load={wa.clients}
                placeholder="Search client ID or company"
                exactMatch={(o, t) => o.client_id.toUpperCase() === t.toUpperCase()}
                onSelect={(c) => setLinking((l) => ({ ...l, client: c, conflict: null }))}
                renderOption={(o) => (
                  <span className="apicker__opt">
                    <strong><span className="mono">{o.client_id}</span> {o.company_name}</strong>
                    <small>{o.city || ''}{o.whatsapp_group_id ? ' · already has a group (will be replaced)' : ''}</small>
                  </span>
                )}
              />
            </div>
            {linking.conflict && (
              <p className="form-note form-note--warn">
                This group is already linked to {linking.conflict.map((c) => `${c.client_id} ${c.company_name}`).join(', ')}. Moving it removes it from there.
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!unlinkGroup}
        busy={busy}
        onClose={() => setUnlinkGroup(null)}
        onConfirm={doUnlink}
        title="Unlink group?"
        confirmLabel="Unlink"
        message={`"${unlinkGroup?.name}" will be removed from ${unlinkGroup?.client_id} ${unlinkGroup?.company_name}. Group messages for that client will stop until it is linked again.`}
      />
      <ConfirmDialog
        open={suggestOpen}
        busy={busy}
        tone="primary"
        confirmLabel="Link Suggested"
        onClose={() => setSuggestOpen(false)}
        onConfirm={linkSuggested}
        title="Link all suggested groups?"
        message="Every group that is not linked yet and whose name starts with a Client ID (e.g. “FSD1166 HEERAMANI…”) is linked to that client — only if the client has no group yet. Existing links are not changed."
      />
    </>
  );
}

function SettingsTab({ manage }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState({ recipients: [], client: null, message: 'Test message from Fifth Seasons Decor ERP.' });
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    wa.settings().then(setData).catch((err) => toast.error('Could not load settings', getErrorMessage(err)));
    wa.recipients().then(setRecipients).catch(() => {});
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      await wa.saveSettings({ crm_person_user_id: data.crm_person_user_id || null, manager_user_id: data.manager_user_id || null });
      toast.success('Recipients saved');
    } catch (err) {
      toast.error('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    setSending(true);
    try {
      setResults(await wa.test({ recipients: test.recipients, client_ref: test.client?.id || null, message: test.message }));
      setConfirmSend(false);
    } catch (err) {
      toast.error('Could not send', getErrorMessage(err));
    } finally {
      setSending(false);
    }
  };

  if (!data) return <div className="card"><Skeleton width="60%" /></div>;
  const needsClient = test.recipients.some((k) => recipients.find((r) => r.key === k)?.client);
  const empLabel = (e) => `${e.name}${e.designation ? ` · ${e.designation}` : ''}${e.phone ? ` · ${e.phone}` : ' · no phone'}`;

  return (
    <div className="form-sections">
      <section className="card form-card">
        <div className="form-card__head">
          <div>
            <h3>Send to whom</h3>
            <p className="card__sub">Every WhatsApp trigger chooses one or more of these recipients.</p>
          </div>
        </div>
        <ul className="wa-recipients">
          <li><strong>Client owner</strong><span>Owner WhatsApp no. (else owner contact no.) from Client Master</span></li>
          <li><strong>Client accountant</strong><span>Accounts person WhatsApp no. from Client Master</span></li>
          <li><strong>Client sales person</strong><span>Customer sales person WhatsApp no. (else contact) from Client Master</span></li>
          <li><strong>Client WhatsApp group</strong><span>The group linked on the Groups tab (client’s WhatsApp group ID)</span></li>
          <li><strong>Fifth Season CRM person</strong><span>Employee chosen below</span></li>
          <li><strong>Fifth Season manager</strong><span>Employee chosen below</span></li>
        </ul>
        <div className="form-grid">
          <Select label="Fifth Season CRM person" value={data.crm_person_user_id ?? ''} disabled={!manage} onChange={(e) => setData((d) => ({ ...d, crm_person_user_id: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">— Not set —</option>
            {data.employees.map((e) => <option key={e.id} value={e.id} disabled={!e.phone}>{empLabel(e)}</option>)}
          </Select>
          <Select label="Fifth Season manager" value={data.manager_user_id ?? ''} disabled={!manage} onChange={(e) => setData((d) => ({ ...d, manager_user_id: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">— Not set —</option>
            {data.employees.map((e) => <option key={e.id} value={e.id} disabled={!e.phone}>{empLabel(e)}</option>)}
          </Select>
        </div>
        {manage && (
          <div className="form-card__foot">
            <Button loading={saving} onClick={save}>Save Recipients</Button>
          </div>
        )}
      </section>

      {manage && (
        <section className="card form-card">
          <div className="form-card__head">
            <div>
              <h3>Send a test message</h3>
              <p className="card__sub">Sends a real WhatsApp message through Maytapi. Use your own client / number to check the setup.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field form-grid__full">
              <span className="field__label">Send to whom<span className="field__req"> *</span></span>
              <div className="chip-select">
                {recipients.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={`chip-select__chip ${test.recipients.includes(r.key) ? 'is-on' : ''}`}
                    onClick={() => setTest((t) => ({ ...t, recipients: t.recipients.includes(r.key) ? t.recipients.filter((x) => x !== r.key) : [...t.recipients, r.key] }))}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {needsClient && (
              <div className="field form-grid__full">
                <span className="field__label">Client<span className="field__req"> *</span></span>
                <AsyncPicker
                  text={test.client ? `${test.client.client_id} · ${test.client.company_name}` : ''}
                  load={wa.clients}
                  placeholder="Search client ID or company"
                  onSelect={(c) => setTest((t) => ({ ...t, client: c }))}
                  renderOption={(o) => (
                    <span className="apicker__opt">
                      <strong><span className="mono">{o.client_id}</span> {o.company_name}</strong>
                      <small>{o.city || ''}</small>
                    </span>
                  )}
                />
              </div>
            )}
            <div className="form-grid__full">
              <Textarea label="Message" required rows={3} maxLength={2000} value={test.message} onChange={(e) => setTest((t) => ({ ...t, message: e.target.value }))} />
            </div>
          </div>
          <div className="form-card__foot">
            <Button
              icon={Send}
              disabled={!test.recipients.length || !test.message.trim() || (needsClient && !test.client)}
              onClick={() => setConfirmSend(true)}
            >
              Send Test
            </Button>
          </div>

          {results && (
            <ul className="sync-history">
              {results.map((r) => (
                <li key={r.type}>
                  {r.status === 'SENT' ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="bad" />}
                  <span className="sync-history__what">
                    {r.label} {r.to ? <span className="mono mono--plain">→ {r.to}</span> : ''}
                    {r.status !== 'SENT' && <small> — {r.error || r.reason}</small>}
                  </span>
                  <span className="sync-history__meta">{r.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmSend}
        busy={sending}
        tone="primary"
        confirmLabel="Send"
        onClose={() => setConfirmSend(false)}
        onConfirm={send}
        title="Send real WhatsApp message?"
        message={`This sends the message now to: ${test.recipients.map((k) => recipients.find((r) => r.key === k)?.label).join(', ')}${test.client ? ` of ${test.client.company_name}` : ''}.`}
      />
    </div>
  );
}
