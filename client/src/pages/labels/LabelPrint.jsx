import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, AlertTriangle } from 'lucide-react';
import { labelsApi, PAPERS, sheetOverflow } from '../../api/labels';
import { getErrorMessage } from '../../api/client';
import { Loader } from '../../components/ui/Loader';
import { Button } from '../../components/ui/Button';
import { LabelCanvas } from '../../components/labels/LabelRenderer';

/**
 * Print preview + print. /labels/print?template=<id>&ids=<record ids>  (or ?stage=<STAGE> to use that stage's default template).
 * Paper "LABEL" = one label per page at the label's size (thermal printers); sheets lay labels out in rows.
 */
export default function LabelPrint() {
  const [params] = useSearchParams();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        let tid = params.get('template');
        if (!tid) {
          const list = await labelsApi.list(params.get('stage'));
          tid = list.find((t) => t.is_default)?.id;
          if (!tid) throw new Error('No default label template for this stage — set one in Masters › Label Design');
        }
        const template = await labelsApi.get(tid);
        const ids = (params.get('ids') || '').split(',').filter(Boolean);
        const records = await labelsApi.data(template.stage, ids);
        if (!records.length) throw new Error('No data found for the selected records');
        setState({ template, records });
      } catch (err) {
        setError(err.response ? getErrorMessage(err) : err.message);
      }
    })();
  }, [params]);

  if (error) {
    return (
      <div className="doc-page"><div className="doc"><div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div></div></div>
    );
  }
  if (!state) return <Loader fullscreen label="Preparing labels…" />;

  const { template: t, records } = state;
  const pc = t.print_config || {};
  const copies = Math.max(1, pc.copies || 1);
  const labels = records.flatMap((r) => Array.from({ length: copies }, (_, i) => ({ key: `${r.id}-${i}`, values: r.fields })));
  const paper = PAPERS.find((p) => p.key === (pc.paper || 'LABEL')) || PAPERS[0];
  const sheet = paper.key !== 'LABEL';
  const pw = paper.key === 'CUSTOM' ? pc.paper_w || 100 : paper.w;
  const ph = paper.key === 'CUSTOM' ? pc.paper_h || 150 : paper.h;
  const pageCss = sheet
    ? `@page { size: ${pw}mm ${ph}mm; margin: 0; }`
    : `@page { size: ${t.width_mm}mm ${t.height_mm}mm; margin: 0; }`;

  return (
    <div className="lbl-print">
      <style>{pageCss}</style>
      <div className="lbl-print__bar">
        <div>
          <strong>{t.name}</strong>
          <span className="cell-sub"> · {labels.length} label(s) · {t.width_mm} × {t.height_mm} mm · {paper.label}</span>
          {pc.printer && <div className="cell-sub">Choose printer <strong>{pc.printer}</strong> in the print dialog.</div>}
          {sheetOverflow(t) && <div className="text-danger">Labels need {sheetOverflow(t).need} mm but the paper is {sheetOverflow(t).paper} mm wide — fewer labels per row, smaller gaps or margin.</div>}
        </div>
        <Button icon={Printer} onClick={() => window.print()}>Print</Button>
      </div>

      {sheet ? (
        <div
          className="lbl-sheet"
          style={{
            width: `${pw}mm`,
            minHeight: `${ph}mm`,
            padding: `${pc.margin ?? 5}mm`,
            gap: `${pc.gap_y ?? 2}mm ${pc.gap_x ?? 2}mm`,
            gridTemplateColumns: `repeat(${Math.max(1, pc.per_row || 1)}, ${t.width_mm}mm)`,
          }}
        >
          {labels.map((l) => <LabelCanvas key={l.key} template={t} values={l.values} />)}
        </div>
      ) : (
        <div className="lbl-roll">
          {labels.map((l) => <LabelCanvas key={l.key} template={t} values={l.values} className="lbl--page" />)}
        </div>
      )}
    </div>
  );
}
