import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select, Textarea, Switch } from '../../components/ui/FormControls';
import { Button } from '../../components/ui/Button';
import { employeesApi } from '../../api/rbac';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  employee_code: '',
  department: '',
  designation: '',
  joining_date: '',
  address: '',
  role_id: '',
  password: '',
  is_active: true,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create / edit an employee.
 * `employee` = null for create. `isSelf` locks role & status so users can't lock themselves out.
 */
export function EmployeeFormModal({ open, employee, roles, isSelf, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = !!employee;
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      employee
        ? {
            ...EMPTY,
            ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, employee[k] ?? EMPTY[k]])),
            role_id: String(employee.role.id),
            password: '',
          }
        : EMPTY
    );
  }, [open, employee]);

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const validate = () => {
    const er = {};
    if (form.name.trim().length < 2) er.name = 'Name must be at least 2 characters';
    if (!EMAIL_RE.test(form.email.trim())) er.email = 'Enter a valid email address';
    if (form.phone && !/^[+\d][\d\s-]{6,18}$/.test(form.phone.trim())) er.phone = 'Enter a valid phone number';
    if (!form.role_id) er.role_id = 'Select a role';
    if (!isEdit && form.password.length < 8) er.password = 'Password must be at least 8 characters';
    if (isEdit && form.password && form.password.length < 8) er.password = 'Password must be at least 8 characters';
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const body = { ...form, role_id: Number(form.role_id) };
    try {
      const saved = isEdit ? await employeesApi.update(employee.id, body) : await employeesApi.create(body);
      toast.success(isEdit ? 'Employee updated' : 'Employee added', `${saved.name} (${saved.employee_code})`);
      onSaved(saved);
    } catch (err) {
      const field = err.response?.data?.field;
      if (field && field in EMPTY) setErrors((er) => ({ ...er, [field]: err.response.data.message }));
      toast.error(isEdit ? 'Could not update employee' : 'Could not add employee', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      title={isEdit ? 'Edit Employee' : 'Add Employee'}
      subtitle={isEdit ? `${employee.employee_code} · ${employee.email}` : 'Create a staff login and assign a role'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="employee-form" loading={saving}>
            {isEdit ? 'Save Changes' : 'Add Employee'}
          </Button>
        </>
      }
    >
      <form id="employee-form" className="form-grid" onSubmit={onSubmit} noValidate>
        <p className="form-section">Personal details</p>
        <Input label="Full name" required value={form.name} onChange={set('name')} error={errors.name} placeholder="e.g. Rahul Sharma" />
        <Input
          label="Employee code"
          value={form.employee_code}
          onChange={set('employee_code')}
          error={errors.employee_code}
          placeholder={isEdit ? '' : 'Auto (EMP-0001)'}
          hint={isEdit ? undefined : 'Leave blank to auto-generate'}
        />
        <Input label="Email" type="email" required value={form.email} onChange={set('email')} error={errors.email} placeholder="name@fifthseasonsdecor.com" />
        <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="+91 98765 43210" />

        <p className="form-section">Job details</p>
        <Input label="Department" value={form.department} onChange={set('department')} placeholder="e.g. Sales, Cutting, Dispatch" />
        <Input label="Designation" value={form.designation} onChange={set('designation')} placeholder="e.g. Sales Executive" />
        <Input label="Joining date" type="date" value={form.joining_date} onChange={set('joining_date')} error={errors.joining_date} />
        <Select
          label="Role"
          required
          value={form.role_id}
          onChange={set('role_id')}
          error={errors.role_id}
          disabled={isSelf}
          hint={isSelf ? 'You cannot change your own role' : 'Controls which modules this employee can access'}
        >
          <option value="">Select role…</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <div className="form-grid__full">
          <Textarea label="Address" value={form.address} onChange={set('address')} rows={2} />
        </div>

        <p className="form-section">Login</p>
        <Input
          label={isEdit ? 'New password' : 'Password'}
          type="password"
          required={!isEdit}
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
          placeholder={isEdit ? 'Leave blank to keep current' : 'Min. 8 characters'}
        />
        <div className="form-grid__switch">
          <Switch
            checked={form.is_active}
            onChange={set('is_active')}
            disabled={isSelf}
            label={form.is_active ? 'Active' : 'Inactive'}
            description={isSelf ? 'You cannot deactivate yourself' : 'Inactive employees cannot sign in'}
          />
        </div>
      </form>
    </Modal>
  );
}
