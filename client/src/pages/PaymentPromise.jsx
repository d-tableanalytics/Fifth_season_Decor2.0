import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { promiseApi, inr, dayFmt } from '../api/crm';
import { getErrorMessage } from '../api/client';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/FormControls';
import { Logo, BRAND_NAME } from '../components/ui/Logo';
import { Loader } from '../components/ui/Loader';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Public (no login) page opened from the WhatsApp ledger: customer promises a payment date + amount. */
export default function PaymentPromise() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ promise_date: '', promise_amount: '', note: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    promiseApi.get(token).then((d) => {
      setData(d);
      setForm((f) => ({ ...f, promise_amount: d.total ? String(d.total) : '' }));
    }).catch((err) => setError(getErrorMessage(err)));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.promise_date) errs.promise_date = 'Choose the date you will pay';
    else if (form.promise_date < today()) errs.promise_date = 'Date cannot be in the past';
    if (!(Number(form.promise_amount) > 0)) errs.promise_amount = 'Enter the amount you will pay';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await promiseApi.submit(token, { promise_date: form.promise_date, promise_amount: Number(form.promise_amount), note: form.note || null });
      setDone(r.message);
    } catch (err) {
      setErrors({ form: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div className="login__head">
      <Logo size={60} />
      <h1>{BRAND_NAME}</h1>
      {data && <p>{data.company_name} · Order {data.enquiry_number}</p>}
    </div>
  );

  if (!data && !error) return <Loader fullscreen label="Loading…" />;

  const closedMsg = error || done || (data.state === 'SUBMITTED'
    ? `Your promise of ${inr(data.promise_amount)} by ${dayFmt(data.promise_date)} has been received and is waiting for approval.`
    : data.state === 'EXPIRED' ? 'This link has expired. Please contact Fifth Seasons Decor for a new one.'
    : data.state === 'CLOSED' ? 'This order no longer needs a payment promise.' : '');

  return (
    <div className="login">
      {closedMsg ? (
        <div className="login__card promise">
          {head}
          <div className={`promise__msg ${done || data?.state === 'SUBMITTED' ? 'is-ok' : ''}`}>
            {done || data?.state === 'SUBMITTED' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
            <p>{closedMsg}</p>
          </div>
        </div>
      ) : (
        <form className="login__card promise" onSubmit={submit} noValidate>
          {head}
          <div className="table-wrap promise__bills">
            <table className="table">
              <thead><tr><th>Bill</th><th>Date</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.bills.map((b, i) => (
                  <tr key={`${b.bill_reference}-${i}`}>
                    <td className="mono mono--plain">{b.bill_reference || '—'}{b.days_overdue > 0 && <small className="promise__due"> {b.days_overdue}d overdue</small>}</td>
                    <td>{dayFmt(b.bill_date)}</td>
                    <td className="num">{inr(b.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}><strong>Total pending</strong></td><td className="num"><strong>{inr(data.total)}</strong></td></tr></tfoot>
            </table>
          </div>

          <Input label="Promise payment date" type="date" required min={today()} value={form.promise_date} error={errors.promise_date}
            onChange={(e) => setForm((f) => ({ ...f, promise_date: e.target.value }))} />
          <Input label="Promise payment amount (₹)" type="number" inputMode="decimal" min="1" step="0.01" required value={form.promise_amount} error={errors.promise_amount}
            onChange={(e) => setForm((f) => ({ ...f, promise_amount: e.target.value }))} />
          <Textarea label="Note (optional)" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          {errors.form && <p className="promise__error">{errors.form}</p>}
          <Button type="submit" size="lg" block loading={busy}>Request Manager Approval</Button>
          <p className="promise__foot">Link valid till {dayFmt(data.expires_at)}</p>
        </form>
      )}
    </div>
  );
}
