import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/** Replace {{field}} bindings with the record's values. Without values (designer), bindings stay visible. */
export const fill = (text, values) =>
  String(text ?? '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) => (values ? values[k] ?? '' : m));

export const FONTS = ['Manrope', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Times New Roman', 'Georgia', 'Courier New', 'Cormorant Garamond'];
export const BARCODE_FORMATS = ['CODE128', 'CODE39', 'EAN13', 'EAN8', 'UPC', 'ITF14'];
export const LOGO_SRC = '/Assets/FSD_LOGO.png';

function Barcode({ value, el }) {
  const ref = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value || ' ', {
        format: el.format || 'CODE128',
        displayValue: el.showText !== false,
        margin: 0,
        fontSize: 14,
        height: 60,
        lineColor: el.color || '#000',
        background: 'transparent',
      });
      ref.current.setAttribute('preserveAspectRatio', 'none');
      ref.current.setAttribute('width', '100%');
      ref.current.setAttribute('height', '100%');
      setErr('');
    } catch {
      setErr(`Not valid for ${el.format}`);
    }
  }, [value, el.format, el.showText, el.color]);
  return (
    <>
      <svg ref={ref} style={{ display: err ? 'none' : 'block', width: '100%', height: '100%' }} />
      {err && <span className="lbl-err">{err}</span>}
    </>
  );
}

function Qr({ value, el }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toString(value || ' ', { type: 'svg', margin: 0, errorCorrectionLevel: el.ecc || 'M', color: { dark: el.color || '#000000', light: '#0000' } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''));
    return () => {
      live = false;
    };
  }, [value, el.ecc, el.color]);
  return <div className="lbl-qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** One element of a label. Position and size are in mm so print output matches the design exactly. */
export function LabelElement({ el, values }) {
  const box = {
    left: `${el.x}mm`,
    top: `${el.y}mm`,
    width: `${el.w}mm`,
    height: `${el.type === 'line' ? Math.max(el.strokeWidth ?? 0.3, 0.1) : el.h}mm`,
    transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
    transformOrigin: 'center',
  };
  if (el.type === 'text') {
    const style = {
      ...box,
      fontFamily: el.fontFamily || 'Manrope',
      fontSize: `${el.fontSize || 10}pt`,
      fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? 'italic' : 'normal',
      textDecoration: el.underline ? 'underline' : 'none',
      color: el.color || '#000',
      background: el.fill || 'transparent',
      textAlign: el.align || 'left',
      justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.valign || 'top'],
      whiteSpace: el.wrap === false ? 'nowrap' : 'pre-wrap',
      lineHeight: el.lineHeight || 1.15,
      border: el.borderWidth ? `${el.borderWidth}mm solid ${el.borderColor || '#000'}` : undefined,
      padding: el.padding ? `${el.padding}mm` : undefined,
    };
    return (
      <div className="lbl-el lbl-text" style={style}>
        <span>{fill(el.content, values)}</span>
      </div>
    );
  }
  if (el.type === 'barcode') return <div className="lbl-el" style={box}><Barcode value={fill(el.content, values)} el={el} /></div>;
  if (el.type === 'qr') return <div className="lbl-el" style={box}><Qr value={fill(el.content, values)} el={el} /></div>;
  if (el.type === 'image') {
    return (
      <div className="lbl-el" style={box}>
        {el.src ? <img src={el.src} alt="" style={{ width: '100%', height: '100%', objectFit: el.fit || 'contain' }} draggable={false} /> : <span className="lbl-err">No image</span>}
      </div>
    );
  }
  const stroke = `${el.strokeWidth ?? 0.3}mm solid ${el.stroke || '#000'}`;
  if (el.type === 'line') return <div className="lbl-el" style={{ ...box, background: el.stroke || '#000' }} />;
  return (
    <div
      className="lbl-el"
      style={{
        ...box,
        border: (el.strokeWidth ?? 0.3) > 0 ? stroke : 'none',
        background: el.fill || 'transparent',
        borderRadius: el.type === 'ellipse' ? '50%' : `${el.radius || 0}mm`,
      }}
    />
  );
}

/** A whole label at real size (mm). */
export function LabelCanvas({ template, values, children, className = '' }) {
  return (
    <div className={`lbl ${className}`} style={{ width: `${template.width_mm}mm`, height: `${template.height_mm}mm` }}>
      {template.elements.map((el) => <LabelElement key={el.id} el={el} values={values} />)}
      {children}
    </div>
  );
}
