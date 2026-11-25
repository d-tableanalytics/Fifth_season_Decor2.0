import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getErrorMessage } from '../api/client';
import { featuresApi, uploadsApi } from '../api/uploads';

/**
 * Shared state for full-page master forms (Client / Transport).
 * - loads the record (or starts from `empty`)
 * - tracks field errors (incl. server `field` errors) and scrolls to the first one
 * - read-only when the user lacks create/edit permission
 * - discards S3 uploads that were never saved
 */
export function useMasterForm({ id, api, empty, perm, folder, listPath, toPayload, imageKeys = [] }) {
  const isNew = !id || id === 'new';
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [values, setValues] = useState(empty);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [s3Enabled, setS3Enabled] = useState(false);
  const pending = useRef(new Set());

  const readOnly = isNew ? !can(perm, 'create') : !can(perm, 'edit');

  useEffect(() => {
    featuresApi.get().then((f) => setS3Enabled(!!f.s3Uploads)).catch(() => {});
  }, []);

  useEffect(() => {
    if (isNew) {
      setValues(empty);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .get(id)
      .then((v) => alive && setValues(v))
      .catch((err) => {
        toast.error('Could not load record', getErrorMessage(err));
        navigate(listPath, { replace: true });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Leaving the page without saving: drop uploads made on it
  useEffect(
    () => () => {
      for (const ref of pending.current) uploadsApi.discard(folder, ref);
    },
    [folder]
  );

  const set = useCallback((key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const showError = (field, message) => {
    setErrors((e) => ({ ...e, [field]: message }));
    requestAnimationFrame(() => document.querySelector(`[data-field="${field}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = toPayload(values);
      const saved = isNew ? await api.create(body) : await api.update(id, body);
      // Uploads now referenced by the record are kept; others are discarded
      const used = new Set(JSON.stringify(saved).match(/s3:\/\/[\w/.-]+/g) || []);
      for (const ref of pending.current) if (!used.has(ref)) uploadsApi.discard(folder, ref);
      pending.current = new Set();
      setValues(saved);
      return saved;
    } catch (err) {
      const field = err.response?.data?.field;
      if (field) showError(field.split('.')[0], err.response.data.message);
      toast.error('Could not save', getErrorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const ctx = {
    values,
    errors,
    set,
    readOnly,
    s3Enabled,
    folder,
    onUploaded: (ref) => pending.current.add(ref),
  };

  return { isNew, values, setValues, errors, showError, loading, saving, readOnly, save, ctx, imageKeys };
}
