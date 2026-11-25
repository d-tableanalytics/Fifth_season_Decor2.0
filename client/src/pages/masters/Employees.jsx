import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Power, Users, RotateCcw } from 'lucide-react';
import { employeesApi } from '../../api/rbac';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { EmployeeFormModal } from './EmployeeFormModal';

const LIMIT = 10;
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDate = (v) => (v ? dateFmt.format(new Date(v)) : '—');
const initials = (name) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export default function Employees() {
  const { user, can } = useAuth();
  const toast = useToast();

  const [filters, setFilters] = useState({ search: '', role_id: '', status: '' });
  const [page, setPage] = useState(1);
  const search = useDebounce(filters.search);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState([]);

  const [form, setForm] = useState({ open: false, employee: null });
  const [confirm, setConfirm] = useState(null); // { type: 'delete'|'status', employee }
  const [busy, setBusy] = useState(false);

  const perms = {
    create: can('employees', 'create'),
    edit: can('employees', 'edit'),
    delete: can('employees', 'delete'),
  };
  // Only a super-admin can manage super-admins (enforced by the API too)
  const canManage = (emp) => user.role.isSuper || !emp.role.is_super;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT, search: search || undefined, role_id: filters.role_id || undefined, status: filters.status || undefined };
      setResult(await employeesApi.list(params));
    } catch (err) {
      toast.error('Could not load employees', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, filters.role_id, filters.status, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    employeesApi.roleOptions().then(setRoles).catch(() => {});
  }, []);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const hasFilters = filters.search || filters.role_id || filters.status;

  const runConfirm = async () => {
    const { type, employee } = confirm;
    setBusy(true);
    try {
      if (type === 'delete') {
        await employeesApi.remove(employee.id);
        toast.success('Employee deleted', employee.name);
        if (result.data.length === 1 && page > 1) setPage((p) => p - 1);
      } else {
        const next = !employee.is_active;
        await employeesApi.setStatus(employee.id, next);
        toast.success(next ? 'Employee activated' : 'Employee deactivated', employee.name);
      }
      setConfirm(null);
      load();
    } catch (err) {
      toast.error('Action failed', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Staff / Employee Master</h2>
          <p className="page-header__sub">Manage staff logins, departments and the role each person works under.</p>
        </div>
        {perms.create && (
          <Button icon={Plus} onClick={() => setForm({ open: true, employee: null })}>
            Add Employee
          </Button>
        )}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search name, email, code or phone…" value={filters.search} onChange={setFilter('search')} />
          </label>
          <select className="toolbar__select" value={filters.role_id} onChange={setFilter('role_id')} aria-label="Filter by role">
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.status} onChange={setFilter('status')} aria-label="Filter by status">
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              onClick={() => {
                setFilters({ search: '', role_id: '', status: '' });
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Code</th>
                <th>Contact</th>
                <th>Department</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Status</th>
                {(perms.edit || perms.delete) && <th className="num">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 + (perms.edit || perms.delete ? 1 : 0) }).map((__, j) => (
                      <td key={j}>
                        <Skeleton width={j === 0 ? 160 : 80} />
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading &&
                result.data.map((e) => {
                  const isSelf = e.id === user.id;
                  const manageable = canManage(e);
                  return (
                    <tr key={e.id} className={e.is_active ? '' : 'is-muted'}>
                      <td>
                        <div className="person">
                          <span className="avatar avatar--sm">{initials(e.name)}</span>
                          <div>
                            <p className="cell-main">
                              {e.name} {isSelf && <Badge size="sm" variant="brand">You</Badge>}
                            </p>
                            <p className="cell-sub">{e.designation || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="mono">{e.employee_code}</td>
                      <td>
                        <p>{e.email}</p>
                        <p className="cell-sub">{e.phone || '—'}</p>
                      </td>
                      <td>{e.department || '—'}</td>
                      <td>
                        <Badge variant={e.role.is_super ? 'brand' : 'neutral'}>{e.role.name}</Badge>
                      </td>
                      <td>{fmtDate(e.joining_date)}</td>
                      <td>
                        <Badge variant={e.is_active ? 'success' : 'danger'} dot>
                          {e.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      {(perms.edit || perms.delete) && (
                        <td className="num">
                          <div className="row-actions">
                            {perms.edit && manageable && (
                              <button className="icon-btn icon-btn--sm" title="Edit" onClick={() => setForm({ open: true, employee: e })}>
                                <Pencil size={15} />
                              </button>
                            )}
                            {perms.edit && manageable && !isSelf && (
                              <button
                                className={`icon-btn icon-btn--sm ${e.is_active ? 'icon-btn--warn' : 'icon-btn--ok'}`}
                                title={e.is_active ? 'Deactivate' : 'Activate'}
                                onClick={() => setConfirm({ type: 'status', employee: e })}
                              >
                                <Power size={15} />
                              </button>
                            )}
                            {perms.delete && manageable && !isSelf && (
                              <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" onClick={() => setConfirm({ type: 'delete', employee: e })}>
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>

          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon">
                <Users size={22} />
              </span>
              <h2>{hasFilters ? 'No matching employees' : 'No employees yet'}</h2>
              <p>{hasFilters ? 'Try a different search or filter.' : 'Add your first staff member to get started.'}</p>
            </div>
          )}
        </div>

        {result.total > 0 && <Pagination page={page} limit={LIMIT} total={result.total} onPage={setPage} />}
      </div>

      <EmployeeFormModal
        open={form.open}
        employee={form.employee}
        roles={roles}
        isSelf={form.employee?.id === user.id}
        onClose={() => setForm({ open: false, employee: null })}
        onSaved={() => {
          setForm({ open: false, employee: null });
          load();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        tone={confirm?.type === 'status' && !confirm.employee.is_active ? 'primary' : 'danger'}
        title={
          confirm?.type === 'delete'
            ? 'Delete employee?'
            : confirm?.employee.is_active
              ? 'Deactivate employee?'
              : 'Activate employee?'
        }
        confirmLabel={confirm?.type === 'delete' ? 'Delete' : confirm?.employee.is_active ? 'Deactivate' : 'Activate'}
        message={
          confirm?.type === 'delete'
            ? `${confirm.employee.name} will be permanently removed and will no longer be able to sign in. Prefer deactivating if you may need their records later.`
            : confirm?.employee.is_active
              ? `${confirm?.employee.name} will be signed out and will not be able to sign in until re-activated.`
              : `${confirm?.employee.name} will be able to sign in again.`
        }
      />
    </div>
  );
}
