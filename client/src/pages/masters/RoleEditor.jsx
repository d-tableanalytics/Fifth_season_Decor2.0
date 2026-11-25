import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Crown, Lock } from 'lucide-react';
import { metaApi, rolesApi } from '../../api/rbac';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/FormControls';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Loader } from '../../components/ui/Loader';
import AccessDenied from '../AccessDenied';

const ACTION_LABELS = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve' };

/** Tri-state checkbox (checked / indeterminate / unchecked). */
function Check({ checked, indeterminate = false, disabled, onChange, label }) {
  return (
    <input
      type="checkbox"
      className="perm-check"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      ref={(el) => el && (el.indeterminate = indeterminate && !checked)}
      onChange={onChange}
    />
  );
}

export default function RoleEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { can, user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [meta, setMeta] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [perms, setPerms] = useState({}); // { moduleKey: Set(actions) }
  const [role, setRole] = useState(null);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([metaApi.modules(), isNew ? null : rolesApi.get(id)])
      .then(([m, r]) => {
        if (!alive) return;
        setMeta(m);
        if (r) {
          setRole(r);
          setForm({ name: r.name, description: r.description || '' });
          setPerms(Object.fromEntries(Object.entries(r.permissions).map(([k, v]) => [k, new Set(v)])));
        }
      })
      .catch((err) => {
        toast.error('Could not load role', getErrorMessage(err));
        navigate('/masters/roles', { replace: true });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, isNew, navigate, toast]);

  const readOnly = role?.is_super || (isNew ? !can('roles', 'create') : !can('roles', 'edit'));

  // Group modules for display, preserving registry order
  const groups = useMemo(() => {
    if (!meta) return [];
    const map = new Map();
    for (const m of meta.modules) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group).push(m);
    }
    return [...map.entries()];
  }, [meta]);

  if (isNew && !can('roles', 'create')) return <AccessDenied />;
  if (loading || !meta) return <Loader label="Loading permissions…" />;

  const has = (key, action) => perms[key]?.has(action) || false;

  const update = (fn) =>
    setPerms((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, new Set(v)]));
      fn(next);
      return next;
    });

  // Rules: any create/edit/delete implies view; removing view removes everything.
  const setAction = (next, mod, action, on) => {
    const s = next[mod.key] || new Set();
    if (on) {
      s.add(action);
      s.add('view');
    } else if (action === 'view') {
      s.clear();
    } else {
      s.delete(action);
    }
    next[mod.key] = s;
  };

  const toggle = (mod, action) => update((next) => setAction(next, mod, action, !has(mod.key, action)));

  const rowAllOn = (mod) => mod.actions.every((a) => has(mod.key, a));
  const toggleRow = (mod) => {
    const on = !rowAllOn(mod);
    update((next) => mod.actions.forEach((a) => setAction(next, mod, a, on)));
  };

  const colModules = (action) => meta.modules.filter((m) => m.actions.includes(action));
  const colState = (action) => {
    const mods = colModules(action);
    const n = mods.filter((m) => has(m.key, action)).length;
    return { all: n === mods.length, some: n > 0 };
  };
  const toggleCol = (action) => {
    const on = !colState(action).all;
    update((next) => colModules(action).forEach((m) => setAction(next, m, action, on)));
  };

  const groupState = (mods) => {
    const total = mods.reduce((s, m) => s + m.actions.length, 0);
    const n = mods.reduce((s, m) => s + m.actions.filter((a) => has(m.key, a)).length, 0);
    return { all: n === total, some: n > 0 };
  };
  const toggleGroup = (mods) => {
    const on = !groupState(mods).all;
    update((next) => mods.forEach((m) => m.actions.forEach((a) => setAction(next, m, a, on))));
  };

  const granted = Object.values(perms).reduce((s, set) => s + set.size, 0);
  const modulesOn = Object.values(perms).filter((s) => s.size).length;

  const onSave = async () => {
    if (form.name.trim().length < 2) {
      setErrors({ name: 'Role name must be at least 2 characters' });
      return;
    }
    setSaving(true);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      permissions: Object.fromEntries(Object.entries(perms).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]])),
    };
    try {
      const saved = isNew ? await rolesApi.create(body) : await rolesApi.update(id, body);
      toast.success(isNew ? 'Role created' : 'Role updated', `${saved.name} · ${granted} permissions`);
      if (!isNew && Number(id) === user.role.id) await refresh(); // own role changed
      navigate('/masters/roles');
    } catch (err) {
      if (err.response?.data?.field === 'name' || err.response?.status === 409) setErrors({ name: getErrorMessage(err) });
      toast.error('Could not save role', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/masters/roles" className="back-link">
            <ArrowLeft size={14} /> Roles &amp; Permissions
          </Link>
          <h2 className="page-header__title">
            {isNew ? 'New Role' : role.name} {role?.is_super && <Badge variant="brand">Full access</Badge>}
            {readOnly && !role?.is_super && <Badge variant="neutral">Read only</Badge>}
          </h2>
        </div>
        {!readOnly && (
          <Button icon={Save} loading={saving} onClick={onSave}>
            {isNew ? 'Create Role' : 'Save Changes'}
          </Button>
        )}
      </div>

      <div className="card role-form">
        <Input
          label="Role name"
          required
          value={form.name}
          disabled={readOnly}
          error={errors.name}
          placeholder="e.g. Cutting Supervisor"
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }));
            setErrors({});
          }}
        />
        <Textarea
          label="Description"
          rows={2}
          value={form.description}
          disabled={readOnly}
          placeholder="What is this role responsible for?"
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      {role?.is_super ? (
        <div className="card notice">
          <span className="notice__icon">
            <Crown size={18} />
          </span>
          <div>
            <h3>Super Administrator has full access</h3>
            <p>This role can do everything in every module, including managing roles. It cannot be edited or deleted.</p>
          </div>
        </div>
      ) : (
        <div className="card card--flush">
          <div className="card__head card__head--pad">
            <div>
              <h3>Permissions</h3>
              <p className="card__sub">
                Create, Edit or Delete automatically includes View. Unchecking View removes all access to that module.
              </p>
            </div>
            <Badge variant="brand">
              {modulesOn} modules · {granted} permissions
            </Badge>
          </div>

          <div className="table-wrap table-wrap--flush">
            <table className="table perm-table">
              <thead>
                <tr>
                  <th>Module</th>
                  {meta.actions.map((a) => {
                    const st = colState(a);
                    return (
                      <th key={a} className="perm-table__col">
                        <label className="perm-table__colhead">
                          <Check checked={st.all} indeterminate={st.some} disabled={readOnly} onChange={() => toggleCol(a)} label={`All ${a}`} />
                          {ACTION_LABELS[a]}
                        </label>
                      </th>
                    );
                  })}
                  <th className="perm-table__col">All</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([group, mods]) => {
                  const gs = groupState(mods);
                  return [
                    <tr key={`g-${group}`} className="perm-table__group">
                      <td colSpan={meta.actions.length + 2}>
                        <label>
                          <Check checked={gs.all} indeterminate={gs.some} disabled={readOnly} onChange={() => toggleGroup(mods)} label={`All of ${group}`} />
                          {group}
                        </label>
                      </td>
                    </tr>,
                    ...mods.map((m) => (
                      <tr key={m.key}>
                        <td className="perm-table__module">{m.label}</td>
                        {meta.actions.map((a) => (
                          <td key={a} className="perm-table__col">
                            {m.actions.includes(a) ? (
                              <Check checked={has(m.key, a)} disabled={readOnly} onChange={() => toggle(m, a)} label={`${m.label} ${a}`} />
                            ) : (
                              <span className="perm-table__na" title="Not applicable">
                                <Lock size={12} />
                              </span>
                            )}
                          </td>
                        ))}
                        <td className="perm-table__col">
                          <Check
                            checked={rowAllOn(m)}
                            indeterminate={!!perms[m.key]?.size}
                            disabled={readOnly}
                            onChange={() => toggleRow(m)}
                            label={`All ${m.label}`}
                          />
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
