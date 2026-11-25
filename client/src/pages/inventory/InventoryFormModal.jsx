import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/FormControls';
import { Button } from '../../components/ui/Button';
import { ImageUploadField } from '../../components/ui/ImageUploadField';
import { inventoryApi, STOCK_TYPES } from '../../api/inventory';
import { featuresApi, uploadsApi } from '../../api/uploads';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';

const EMPTY = {
  stock_type: 'CUT',
  item_name: '',
  rack_no: '',
  quantity: '',
  unit: 'Mtr',
  catalogue_name: '',
  image_url: '',
  hsn_code: '',
  lot_no: '',
  price: '',
};

export function InventoryFormModal({ open, item, defaultType, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = !!item;
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null); // signed URL for an S3 image
  const [s3Enabled, setS3Enabled] = useState(false);
  const pendingUploads = useRef(new Set()); // S3 files uploaded in this session but not saved yet

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setPreviewUrl(item?.image_view_url || null);
    pendingUploads.current = new Set();
    setForm(
      item
        ? Object.fromEntries(Object.keys(EMPTY).map((k) => [k, item[k] ?? '']))
        : { ...EMPTY, stock_type: defaultType || 'CUT' }
    );
    featuresApi
      .get()
      .then((f) => setS3Enabled(!!f.s3Uploads))
      .catch(() => setS3Enabled(false));
  }, [open, item, defaultType]);

  /** Delete uploaded-but-unused S3 files (keep `keep`, the one that was saved). */
  const discardPending = (keep) => {
    for (const ref of pendingUploads.current) if (ref !== keep) uploadsApi.discardInventoryImage(ref);
    pendingUploads.current = new Set();
  };

  const close = () => {
    if (saving) return;
    discardPending(null);
    onClose();
  };

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const validate = () => {
    const er = {};
    if (!form.item_name.trim()) er.item_name = 'Item name is required';
    if (form.stock_type !== 'IN_CHECKING' && !form.rack_no.trim()) er.rack_no = 'Rack no. is required';
    if (form.quantity !== '' && Number.isNaN(Number(form.quantity))) er.quantity = 'Enter a number';
    if (form.price !== '' && Number.isNaN(Number(form.price))) er.price = 'Enter a number';
    if (form.image_url && !/^(https?|s3):\/\//i.test(form.image_url.trim())) er.image_url = 'Must start with http:// or https://';
    setErrors(er);
    return !Object.keys(er).length;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const saved = isEdit ? await inventoryApi.update(item.id, form) : await inventoryApi.create(form);
      toast.success(isEdit ? 'Item updated' : 'Item added', saved.item_name);
      discardPending(saved.image_url);
      onSaved(saved);
    } catch (err) {
      const field = err.response?.data?.field;
      if (field) setErrors((er) => ({ ...er, [field]: err.response.data.message }));
      if (err.response?.status === 409) setErrors((er) => ({ ...er, item_name: getErrorMessage(err) }));
      toast.error(isEdit ? 'Could not update item' : 'Could not add item', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      busy={saving}
      size="lg"
      title={isEdit ? 'Edit Stock Item' : 'Add Stock Item'}
      subtitle={isEdit ? `${item.item_name} · ${item.rack_no || 'No rack'}` : 'Add an item manually'}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="inventory-form" loading={saving}>
            {isEdit ? 'Save Changes' : 'Add Item'}
          </Button>
        </>
      }
    >
      {isEdit && item.source === 'SHEET' && (
        <p className="form-note">
          <Info size={15} />
          This item comes from Google Sheet. The next <strong>full sync</strong> will overwrite name, rack, quantity, unit,
          catalogue, image and lot with the sheet values. Update the sheet to make lasting changes.
        </p>
      )}
      <form id="inventory-form" className="form-grid" onSubmit={onSubmit} noValidate>
        <Select label="Stock type" required value={form.stock_type} onChange={set('stock_type')}>
          {STOCK_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
        <Input label="Catalogue name" value={form.catalogue_name} onChange={set('catalogue_name')} placeholder="e.g. FOLDER MARVEL COLLECTION" />
        <div className="form-grid__full">
          <Input label="Item name (SKU)" required value={form.item_name} onChange={set('item_name')} error={errors.item_name} placeholder='e.g. CALVIN DIMOUT 60" PRINT' />
        </div>
        <Input
          label="Rack no."
          required={form.stock_type !== 'IN_CHECKING'}
          value={form.rack_no}
          onChange={set('rack_no')}
          error={errors.rack_no}
          placeholder="e.g. 1974-1 RITU GODOWN"
        />
        <Input label="Lot no." value={form.lot_no} onChange={set('lot_no')} placeholder="e.g. 1974-1" />
        <Input label="Quantity" type="number" step="0.01" value={form.quantity} onChange={set('quantity')} error={errors.quantity} placeholder="0" />
        <Input label="Unit" value={form.unit} onChange={set('unit')} placeholder="Mtr" />
        <Input label="Price (₹)" type="number" step="0.01" value={form.price} onChange={set('price')} error={errors.price} placeholder="Reference price" />
        <Input label="HSN code" value={form.hsn_code} onChange={set('hsn_code')} placeholder="e.g. 5407" />
        <div className="form-grid__full">
          <ImageUploadField
            label="Image"
            value={form.image_url}
            previewUrl={previewUrl}
            s3Enabled={s3Enabled}
            error={errors.image_url}
            alt={form.item_name}
            onUploaded={(ref) => pendingUploads.current.add(ref)}
            onChange={(value, preview) => {
              setForm((f) => ({ ...f, image_url: value }));
              setPreviewUrl(preview);
              setErrors((er) => ({ ...er, image_url: undefined }));
            }}
          />
        </div>
      </form>
    </Modal>
  );
}
