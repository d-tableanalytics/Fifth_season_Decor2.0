import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Save, Type, Barcode as BarcodeIcon, QrCode, Image as ImageIcon, Award, Square, Circle, Minus, ZoomIn, ZoomOut,
  Trash2, Copy, ArrowUpToLine, ArrowDownToLine, Undo2, Printer, Braces, Eye, EyeOff,
} from 'lucide-react';
import { labelsApi, STAGE_LABEL, PAPERS, sheetOverflow } from '../../api/labels';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { AsyncPicker } from '../../components/forms/AsyncPicker';
import { LabelElement, FONTS, BARCODE_FORMATS, LOGO_SRC } from '../../components/labels/LabelRenderer';

const PX_PER_MM = 96 / 25.4;
const SNAP = 0.5;
const snap = (v) => Math.round(v / SNAP) * SNAP;
const uid = () => Math.random().toString(36).slice(2, 10);
const MAX_IMAGE_BYTES = 300 * 1024;

const NEW_ELEMENT = {
  text: () => ({ type: 'text', w: 40, h: 7, content: 'Text', fontSize: 10, fontFamily: 'Manrope' }),
  barcode: (f) => ({ type: 'barcode', w: 50, h: 14, content: f ? `{{${f}}}` : '123456', format: 'CODE128', showText: true }),
  qr: (f) => ({ type: 'qr', w: 18, h: 18, content: f ? `{{${f}}}` : 'Fifth Seasons Decor' }),
  image: () => ({ type: 'image', w: 20, h: 20, src: '', fit: 'contain' }),
  logo: () => ({ type: 'image', w: 18, h: 18, src: LOGO_SRC, fit: 'contain' }),
  rect: () => ({ type: 'rect', w: 30, h: 15, strokeWidth: 0.3, stroke: '#000000', fill: '', radius: 0 }),
  ellipse: () => ({ type: 'ellipse', w: 20, h: 12, strokeWidth: 0.3, stroke: '#000000', fill: '' }),
  line: () => ({ type: 'line', w: 40, h: 0, strokeWidth: 0.3, stroke: '#000000' }),
};
const TOOLS = [
  { key: 'text', label: 'Text', icon: Type },
  { key: 'barcode', label: 'Barcode', icon: BarcodeIcon },
  { key: 'qr', label: 'QR code', icon: QrCode },
  { key: 'image', label: 'Image', icon: ImageIcon },
  { key: 'logo', label: 'Logo', icon: Award },
  { key: 'rect', label: 'Rectangle / Border', icon: Square },
  { key: 'ellipse', label: 'Ellipse', icon: Circle },
  { key: 'line', label: 'Line', icon: Minus },
];
const blankTemplate = (stage) => ({
  name: 'New label',
  stage: stage || 'CUT_ITEM',
  width_mm: 75,
  height_mm: 50,
  elements: [],
  print_config: { paper: 'LABEL', per_row: 1, gap_x: 2, gap_y: 2, margin: 0, copies: 1, printer: '' },
});

/** Label Design › designer: drag-and-drop label with bindings to the stage's ERP fields and live preview. */
export default function LabelDesigner() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const isNew = id === 'new';
  const canSave = isNew ? can('label_design', 'create') : can('label_design', 'edit');

  const [stages, setStages] = useState([]);
  const [t, setT] = useState(null);
  const [savedJson, setSavedJson] = useState('');
  const [selId, setSelId] = useState(null);
  const [zoom, setZoom] = useState(2);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(null);
  const [values, setValues] = useState(null);
  const [showData, setShowData] = useState(true);
  const history = useRef([]);
  const canvasRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    labelsApi.stages().then(setStages).catch(() => {});
    const load = isNew ? Promise.resolve(blankTemplate(params.get('stage'))) : labelsApi.get(id);
    load
      .then((tpl) => {
        setT(tpl);
        setSavedJson(JSON.stringify(tpl));
      })
      .catch((err) => {
        toast.error('Could not open template', getErrorMessage(err));
        navigate('/masters/labels');
      });
  }, [id, isNew, params, navigate, toast]);

  const dirty = t && JSON.stringify(t) !== savedJson;
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const stage = stages.find((s) => s.key === t?.stage);
  const fields = stage?.fields || [];
  const sel = t?.elements.find((e) => e.id === selId) || null;

  /** Every change goes through here so it can be undone. */
  const update = useCallback((fn) => {
    setT((cur) => {
      history.current = [...history.current.slice(-49), cur];
      return fn(cur);
    });
  }, []);
  const setEls = (fn) => update((cur) => ({ ...cur, elements: fn(cur.elements) }));
  const patchSel = (patch) => setEls((els) => els.map((e) => (e.id === selId ? { ...e, ...patch } : e)));
  const undo = () => {
    const prev = history.current.pop();
    if (prev) setT(prev);
  };

  const add = (kind, field) => {
    const base = NEW_ELEMENT[kind](field || fields[0]?.key);
    const el = { id: uid(), x: snap(Math.max(0, (t.width_mm - base.w) / 2)), y: snap(Math.max(0, (t.height_mm - (base.h || 1)) / 2)), ...base };
    if (kind === 'text' && field) el.content = `{{${field}}}`;
    setEls((els) => [...els, el]);
    setSelId(el.id);
  };

  /** Field click: insert into the selected text / barcode / QR, or add a new text bound to it. */
  const insertField = (key) => {
    if (sel && ['text', 'barcode', 'qr'].includes(sel.type)) {
      patchSel({ content: sel.type === 'text' && sel.content && sel.content !== 'Text' ? `${sel.content} {{${key}}}` : `{{${key}}}` });
    } else add('text', key);
  };

  const remove = () => {
    if (!sel) return;
    setEls((els) => els.filter((e) => e.id !== sel.id));
    setSelId(null);
  };
  const duplicate = () => {
    if (!sel) return;
    const copy = { ...sel, id: uid(), x: snap(sel.x + 2), y: snap(sel.y + 2) };
    setEls((els) => [...els, copy]);
    setSelId(copy.id);
  };
  const layer = (dir) =>
    setEls((els) => {
      const rest = els.filter((e) => e.id !== selId);
      return dir === 'front' ? [...rest, sel] : [sel, ...rest];
    });

  /* ---------- Drag / resize on the canvas ---------- */
  const scale = PX_PER_MM * zoom;
  const startDrag = (e, el, mode) => {
    e.stopPropagation();
    e.preventDefault();
    setSelId(el.id);
    if (!canSave) return;
    drag.current = { mode, id: el.id, sx: e.clientX, sy: e.clientY, orig: { ...el }, before: t, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    d.moved = true;
    setT((cur) => ({
      ...cur,
      elements: cur.elements.map((el) => {
        if (el.id !== d.id) return el;
        if (d.mode === 'move') return { ...el, x: snap(d.orig.x + dx), y: snap(d.orig.y + dy) };
        return { ...el, w: Math.max(1, snap(d.orig.w + dx)), h: el.type === 'line' ? el.h : Math.max(1, snap(d.orig.h + dy)) };
      }),
    }));
  };
  const endDrag = () => {
    const d = drag.current;
    if (d?.moved) history.current = [...history.current.slice(-49), d.before];
    drag.current = null;
  };

  /* ---------- Keyboard ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('lbl-save')?.click();
        return;
      }
      if (typing || !canSave) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') return void (e.preventDefault(), undo());
      if (!sel) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') return void (e.preventDefault(), duplicate());
      if (e.key === 'Delete' || e.key === 'Backspace') return void (e.preventDefault(), remove());
      const step = e.shiftKey ? 5 : SNAP;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        patchSel({ x: snap(sel.x + mv[0]), y: snap(sel.y + mv[1]) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- Live preview data ---------- */
  useEffect(() => {
    setValues(null);
    if (!record || !t) return;
    labelsApi.data(t.stage, [record.id]).then((d) => setValues(d[0]?.fields || null)).catch((err) => toast.error('Could not load record', getErrorMessage(err)));
  }, [record, t?.stage, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const body = { name: t.name, stage: t.stage, width_mm: t.width_mm, height_mm: t.height_mm, elements: t.elements, print_config: t.print_config };
      const saved = isNew ? await labelsApi.create(body) : await labelsApi.update(id, body);
      setT(saved);
      setSavedJson(JSON.stringify(saved));
      toast.success('Label template saved');
      if (isNew) navigate(`/masters/labels/${saved.id}`, { replace: true });
    } catch (err) {
      toast.error('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const printPreview = () => {
    if (isNew || dirty) return toast.info('Save the template first');
    if (!record) return toast.info('Choose a record to print');
    window.open(`/labels/print?template=${id}&ids=${record.id}`, '_blank', 'noopener');
  };

  const onImage = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(file.type)) return toast.error('Choose a PNG, JPG, GIF, WEBP or SVG image');
    if (file.size > MAX_IMAGE_BYTES) return toast.error('Image is too large', 'Keep it under 300 KB');
    const r = new FileReader();
    r.onload = () => patchSel({ src: r.result });
    r.readAsDataURL(file);
  };

  const pc = t?.print_config || {};
  const setPc = (patch) => update((cur) => ({ ...cur, print_config: { ...cur.print_config, ...patch } }));
  const previewValues = showData ? values : null;
  const usedFields = useMemo(() => new Set((t?.elements || []).flatMap((e) => [...String(e.content || '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]))), [t]);

  if (!t) return <Loader label="Loading designer…" />;

  return (
    <div className="page lbl-designer" onPointerMove={onMove} onPointerUp={endDrag}>
      <div className="lbl-topbar">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => navigate('/masters/labels')}>Templates</Button>
        <input className="lbl-name" value={t.name} maxLength={120} disabled={!canSave} onChange={(e) => update((c) => ({ ...c, name: e.target.value }))} aria-label="Template name" />
        <select className="toolbar__select" value={t.stage} disabled={!canSave} onChange={(e) => { setRecord(null); update((c) => ({ ...c, stage: e.target.value })); }} aria-label="Stage">
          {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="lbl-size">
          <input type="number" min="10" max="400" step="0.5" value={t.width_mm} disabled={!canSave} onChange={(e) => update((c) => ({ ...c, width_mm: Number(e.target.value) || 10 }))} aria-label="Width (mm)" />
          ×
          <input type="number" min="10" max="400" step="0.5" value={t.height_mm} disabled={!canSave} onChange={(e) => update((c) => ({ ...c, height_mm: Number(e.target.value) || 10 }))} aria-label="Height (mm)" />
          <span className="cell-sub">mm</span>
        </div>
        <div className="lbl-topbar__right">
          {canSave && <Button size="sm" variant="ghost" icon={Undo2} disabled={!history.current.length} onClick={undo} title="Undo (Ctrl+Z)">Undo</Button>}
          <Button size="sm" variant="secondary" icon={Printer} onClick={printPreview}>Print preview</Button>
          {canSave && <Button id="lbl-save" size="sm" icon={Save} loading={busy} disabled={!dirty} onClick={save}>Save</Button>}
        </div>
      </div>

      <div className="lbl-workspace">
        {/* Tools + fields */}
        <aside className="lbl-panel">
          {canSave && (
            <>
              <h4>Add</h4>
              <div className="lbl-tools">
                {TOOLS.map(({ key, label, icon: Icon }) => (
                  <button key={key} type="button" className="lbl-tool" onClick={() => add(key)} title={label}>
                    <Icon size={16} /><span>{label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <h4><Braces size={13} /> {STAGE_LABEL[t.stage]} fields</h4>
          <p className="cell-sub lbl-hint">{sel && ['text', 'barcode', 'qr'].includes(sel.type) ? 'Click a field to insert it into the selected element.' : 'Click a field to add it as text.'}</p>
          <ul className="lbl-fields">
            {fields.map((f) => (
              <li key={f.key}>
                <button type="button" disabled={!canSave} onClick={() => insertField(f.key)} title={`{{${f.key}}}`}>
                  <span>{f.label}</span>
                  {values && <small>{String(values[f.key] ?? '').split('\n')[0] || '—'}</small>}
                  {usedFields.has(f.key) && <i className="lbl-dot" aria-label="used" />}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Canvas */}
        <section className="lbl-stage">
          <div className="lbl-stage__bar">
            <div className="lbl-record">
              <AsyncPicker
                key={t.stage}
                text={record ? record.title : ''}
                load={(s) => labelsApi.records(t.stage, s)}
                placeholder={`Preview with a ${STAGE_LABEL[t.stage]} record…`}
                onSelect={setRecord}
                renderOption={(o) => (
                  <span className="apicker__opt"><strong>{o.title}</strong><small>{o.subtitle}</small></span>
                )}
              />
            </div>
            <Button size="sm" variant="ghost" icon={showData ? Eye : EyeOff} disabled={!values} onClick={() => setShowData((s) => !s)}>
              {showData ? 'Live data' : 'Field names'}
            </Button>
            <div className="lbl-zoom">
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out"><ZoomOut size={15} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" className="icon-btn icon-btn--sm" onClick={() => setZoom((z) => Math.min(6, z + 0.25))} aria-label="Zoom in"><ZoomIn size={15} /></button>
            </div>
          </div>
          <div className="lbl-stage__scroll" onPointerDown={() => setSelId(null)}>
            <div className="lbl-zoombox" style={{ width: `${t.width_mm * scale}px`, height: `${t.height_mm * scale}px` }}>
              <div ref={canvasRef} className="lbl lbl--design" style={{ width: `${t.width_mm}mm`, height: `${t.height_mm}mm`, transform: `scale(${zoom})` }}>
                {t.elements.map((el) => <LabelElement key={el.id} el={el} values={previewValues} />)}
                {t.elements.map((el) => (
                  <div
                    key={`h-${el.id}`}
                    className={`lbl-hit ${el.id === selId ? 'is-sel' : ''}`}
                    style={{ left: `${el.x}mm`, top: `${el.y}mm`, width: `${Math.max(el.w, 1)}mm`, height: `${el.type === 'line' ? 1.5 : Math.max(el.h, 1)}mm`, marginTop: el.type === 'line' ? '-0.6mm' : 0 }}
                    onPointerDown={(e) => startDrag(e, el, 'move')}
                  >
                    {el.id === selId && canSave && <span className="lbl-handle" onPointerDown={(e) => startDrag(e, el, 'resize')} />}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="cell-sub lbl-hint">Drag to move · corner handle to resize · arrows nudge 0.5 mm (Shift = 5 mm) · Del delete · Ctrl+D duplicate · Ctrl+Z undo</p>
        </section>

        {/* Properties */}
        <aside className="lbl-panel lbl-props">
          {sel ? (
            <ElementProps el={sel} patch={patchSel} canSave={canSave} onImage={onImage} onDelete={remove} onDuplicate={duplicate} onLayer={layer} />
          ) : (
            <>
              <h4>Print settings</h4>
              <label className="lbl-prop">Paper
                <select value={pc.paper || 'LABEL'} disabled={!canSave} onChange={(e) => setPc({ paper: e.target.value })}>
                  {PAPERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </label>
              {pc.paper === 'CUSTOM' && (
                <div className="lbl-prop-row">
                  <NumProp label="Paper W" value={pc.paper_w ?? 100} onChange={(v) => setPc({ paper_w: v })} disabled={!canSave} />
                  <NumProp label="Paper H" value={pc.paper_h ?? 150} onChange={(v) => setPc({ paper_h: v })} disabled={!canSave} />
                </div>
              )}
              {pc.paper && pc.paper !== 'LABEL' && (
                <>
                  <div className="lbl-prop-row">
                    <NumProp label="Labels per row" value={pc.per_row ?? 1} step={1} min={1} onChange={(v) => setPc({ per_row: Math.max(1, Math.round(v)) })} disabled={!canSave} />
                    <NumProp label="Margin" value={pc.margin ?? 5} onChange={(v) => setPc({ margin: v })} disabled={!canSave} />
                  </div>
                  <div className="lbl-prop-row">
                    <NumProp label="Gap X" value={pc.gap_x ?? 2} onChange={(v) => setPc({ gap_x: v })} disabled={!canSave} />
                    <NumProp label="Gap Y" value={pc.gap_y ?? 2} onChange={(v) => setPc({ gap_y: v })} disabled={!canSave} />
                  </div>
                </>
              )}
              {sheetOverflow(t) && <p className="text-danger lbl-hint">Labels need {sheetOverflow(t).need} mm across but the paper is {sheetOverflow(t).paper} mm.</p>}
              <NumProp label="Copies per record" value={pc.copies ?? 1} step={1} min={1} onChange={(v) => setPc({ copies: Math.max(1, Math.round(v)) })} disabled={!canSave} />
              <label className="lbl-prop">Printer (name to pick in the print dialog)
                <input value={pc.printer || ''} maxLength={120} disabled={!canSave} placeholder="e.g. TSC TE244" onChange={(e) => setPc({ printer: e.target.value })} />
              </label>
              <p className="cell-sub lbl-hint">The browser asks for the printer when printing; the name saved here is shown as a reminder. Set the printer's paper to the label size and margins to none.</p>
              <h4>Elements ({t.elements.length})</h4>
              <ul className="lbl-layers">
                {[...t.elements].reverse().map((el) => (
                  <li key={el.id}><button type="button" onClick={() => setSelId(el.id)}>{el.type} · {String(el.content || el.src || '').slice(0, 24) || '—'}</button></li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function NumProp({ label, value, onChange, step = 0.5, min = -50, disabled }) {
  return (
    <label className="lbl-prop">
      {label}
      <input type="number" step={step} min={min} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </label>
  );
}

function ElementProps({ el, patch, canSave, onImage, onDelete, onDuplicate, onLayer }) {
  const d = !canSave;
  const isText = el.type === 'text';
  return (
    <>
      <div className="lbl-props__head">
        <h4>{el.type === 'image' && el.src === LOGO_SRC ? 'logo' : el.type}</h4>
        {canSave && (
          <div className="lbl-props__actions">
            <button type="button" className="icon-btn icon-btn--sm" title="Bring to front" onClick={() => onLayer('front')}><ArrowUpToLine size={14} /></button>
            <button type="button" className="icon-btn icon-btn--sm" title="Send to back" onClick={() => onLayer('back')}><ArrowDownToLine size={14} /></button>
            <button type="button" className="icon-btn icon-btn--sm" title="Duplicate (Ctrl+D)" onClick={onDuplicate}><Copy size={14} /></button>
            <button type="button" className="icon-btn icon-btn--sm icon-btn--danger" title="Delete (Del)" onClick={onDelete}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      <div className="lbl-prop-row">
        <NumProp label="X (mm)" value={el.x} onChange={(v) => patch({ x: v })} disabled={d} />
        <NumProp label="Y (mm)" value={el.y} onChange={(v) => patch({ y: v })} disabled={d} />
      </div>
      <div className="lbl-prop-row">
        <NumProp label="Width" value={el.w} min={1} onChange={(v) => patch({ w: Math.max(1, v) })} disabled={d} />
        {el.type !== 'line' && <NumProp label="Height" value={el.h} min={1} onChange={(v) => patch({ h: Math.max(1, v) })} disabled={d} />}
      </div>
      <label className="lbl-prop">Rotate
        <select value={el.rotate || 0} disabled={d} onChange={(e) => patch({ rotate: Number(e.target.value) })}>
          {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
        </select>
      </label>

      {['text', 'barcode', 'qr'].includes(el.type) && (
        <label className="lbl-prop">{isText ? 'Text (use {{field}} for data)' : 'Value (use {{field}} for data)'}
          <textarea rows={isText ? 3 : 2} value={el.content || ''} disabled={d} onChange={(e) => patch({ content: e.target.value })} />
        </label>
      )}

      {isText && (
        <>
          <label className="lbl-prop">Font
            <select value={el.fontFamily || 'Manrope'} disabled={d} onChange={(e) => patch({ fontFamily: e.target.value })}>
              {FONTS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <div className="lbl-prop-row">
            <NumProp label="Size (pt)" value={el.fontSize || 10} step={0.5} min={4} onChange={(v) => patch({ fontSize: Math.max(4, v) })} disabled={d} />
            <label className="lbl-prop">Colour<input type="color" value={el.color || '#000000'} disabled={d} onChange={(e) => patch({ color: e.target.value })} /></label>
          </div>
          <div className="lbl-toggles">
            {[['bold', 'B'], ['italic', 'I'], ['underline', 'U']].map(([k, l]) => (
              <button key={k} type="button" className={`lbl-toggle ${el[k] ? 'is-on' : ''} lbl-toggle--${k}`} disabled={d} onClick={() => patch({ [k]: !el[k] })}>{l}</button>
            ))}
            <span className="lbl-sep" />
            {['left', 'center', 'right'].map((a) => (
              <button key={a} type="button" className={`lbl-toggle ${(el.align || 'left') === a ? 'is-on' : ''}`} disabled={d} onClick={() => patch({ align: a })}>{a[0].toUpperCase()}</button>
            ))}
            <span className="lbl-sep" />
            {['top', 'middle', 'bottom'].map((a) => (
              <button key={a} type="button" title={`Vertical ${a}`} className={`lbl-toggle ${(el.valign || 'top') === a ? 'is-on' : ''}`} disabled={d} onClick={() => patch({ valign: a })}>{a === 'top' ? '⤒' : a === 'middle' ? '↕' : '⤓'}</button>
            ))}
          </div>
          <label className="lbl-check"><input type="checkbox" checked={el.wrap !== false} disabled={d} onChange={(e) => patch({ wrap: e.target.checked })} /> Wrap text</label>
          <div className="lbl-prop-row">
            <NumProp label="Border (mm)" value={el.borderWidth || 0} step={0.1} min={0} onChange={(v) => patch({ borderWidth: Math.max(0, v) })} disabled={d} />
            <NumProp label="Padding" value={el.padding || 0} step={0.5} min={0} onChange={(v) => patch({ padding: Math.max(0, v) })} disabled={d} />
          </div>
          <label className="lbl-prop">Background<input type="color" value={el.fill || '#ffffff'} disabled={d} onChange={(e) => patch({ fill: e.target.value })} /></label>
          {el.fill && <button type="button" className="inline-link" disabled={d} onClick={() => patch({ fill: '' })}>No background</button>}
        </>
      )}

      {el.type === 'barcode' && (
        <>
          <label className="lbl-prop">Format
            <select value={el.format || 'CODE128'} disabled={d} onChange={(e) => patch({ format: e.target.value })}>
              {BARCODE_FORMATS.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label className="lbl-check"><input type="checkbox" checked={el.showText !== false} disabled={d} onChange={(e) => patch({ showText: e.target.checked })} /> Show text under bars</label>
        </>
      )}
      {el.type === 'qr' && (
        <label className="lbl-prop">Error correction
          <select value={el.ecc || 'M'} disabled={d} onChange={(e) => patch({ ecc: e.target.value })}>
            {['L', 'M', 'Q', 'H'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      )}
      {el.type === 'image' && (
        <>
          <label className="lbl-prop">Image URL
            <input value={el.src?.startsWith('data:') ? '(uploaded image)' : el.src || ''} disabled={d || el.src?.startsWith('data:')} onChange={(e) => patch({ src: e.target.value })} placeholder="https://… or upload" />
          </label>
          {!d && (
            <div className="lbl-prop-row">
              <label className="btn btn--secondary btn--sm lbl-upload">Upload<input type="file" accept="image/*" hidden onChange={(e) => onImage(e.target.files?.[0])} /></label>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => patch({ src: LOGO_SRC })}>Use company logo</button>
            </div>
          )}
          <label className="lbl-prop">Fit
            <select value={el.fit || 'contain'} disabled={d} onChange={(e) => patch({ fit: e.target.value })}>
              <option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Stretch</option>
            </select>
          </label>
        </>
      )}
      {['rect', 'ellipse', 'line'].includes(el.type) && (
        <>
          <div className="lbl-prop-row">
            <NumProp label={el.type === 'line' ? 'Thickness' : 'Border (mm)'} value={el.strokeWidth ?? 0.3} step={0.1} min={0} onChange={(v) => patch({ strokeWidth: Math.max(0, v) })} disabled={d} />
            <label className="lbl-prop">Colour<input type="color" value={el.stroke || '#000000'} disabled={d} onChange={(e) => patch({ stroke: e.target.value })} /></label>
          </div>
          {el.type !== 'line' && (
            <>
              <label className="lbl-prop">Fill<input type="color" value={el.fill || '#ffffff'} disabled={d} onChange={(e) => patch({ fill: e.target.value })} /></label>
              {el.fill && <button type="button" className="inline-link" disabled={d} onClick={() => patch({ fill: '' })}>No fill</button>}
            </>
          )}
          {el.type === 'rect' && <NumProp label="Corner radius" value={el.radius || 0} step={0.5} min={0} onChange={(v) => patch({ radius: Math.max(0, v) })} disabled={d} />}
        </>
      )}
      {['barcode', 'qr'].includes(el.type) && (
        <label className="lbl-prop">Colour<input type="color" value={el.color || '#000000'} disabled={d} onChange={(e) => patch({ color: e.target.value })} /></label>
      )}
    </>
  );
}
