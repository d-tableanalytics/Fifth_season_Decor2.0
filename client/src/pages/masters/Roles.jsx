import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, Users, Layers, Pencil, Trash2, Eye, Crown } from 'lucide-react';
import { rolesApi } from '../../api/rbac';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { ConfirmDialog } from '../../components/ui/Modal';

export default function Roles() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRoles(await rolesApi.list());
    } catch (err) {
      toast.error('Could not load roles', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async () => {
    setBusy(true);
    try {
      await rolesApi.remove(toDelete.id);
      toast.success('Role deleted', toDelete.name);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not delete role', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Roles &amp; Permissions</h2>
          <p className="page-header__sub">Define what each role can view, create, edit and delete across the ERP.</p>
        </div>
        {can('roles', 'create') && (
          <Button icon={Plus} onClick={() => navigate('/masters/roles/new')}>
            Add Role
          </Button>
        )}
      </div>

      <div className="role-grid">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card role-card">
              <Skeleton width="50%" height={18} />
              <Skeleton width="90%" />
              <Skeleton width="70%" />
            </div>
          ))}

        {!loading &&
          roles.map((r) => {
            const editable = !r.is_super && can('roles', 'edit');
            const deletable = !r.is_system && can('roles', 'delete');
            return (
              <div key={r.id} className={`card role-card ${r.is_super ? 'role-card--super' : ''}`}>
                <div className="role-card__head">
                  <span className="role-card__icon">{r.is_super ? <Crown size={18} /> : <ShieldCheck size={18} />}</span>
                  <div className="role-card__title">
                    <h3>{r.name}</h3>
                    <div className="badge-row">
                      {r.is_super && <Badge size="sm" variant="brand">Full access</Badge>}
                      {r.is_system && <Badge size="sm" variant="neutral">System</Badge>}
                    </div>
                  </div>
                </div>
                <p className="role-card__desc">{r.description || 'No description'}</p>
                <div className="role-card__meta">
                  <span>
                    <Users size={14} /> {r.user_count} {r.user_count === 1 ? 'employee' : 'employees'}
                  </span>
                  <span>
                    <Layers size={14} /> {r.is_super ? 'All modules' : `${r.module_count} modules`}
                  </span>
                </div>
                <div className="role-card__actions">
                  <Link to={`/masters/roles/${r.id}`} className="btn btn--secondary btn--sm">
                    {editable ? <Pencil size={14} /> : <Eye size={14} />}
                    <span>{editable ? 'Edit permissions' : 'View permissions'}</span>
                  </Link>
                  {deletable && (
                    <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete role" onClick={() => setToDelete(r)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      <ConfirmDialog
        open={!!toDelete}
        busy={busy}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Delete role?"
        message={
          toDelete?.user_count
            ? `${toDelete.user_count} employee(s) still have the "${toDelete.name}" role. Move them to another role first.`
            : `The "${toDelete?.name}" role and its permissions will be permanently removed.`
        }
      />
    </div>
  );
}
