import { useMemo, useState } from 'react';
import { Boxes, TriangleAlert, PackageOpen, IndianRupee, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { DateRangePicker, getRange, daysInRange } from '../components/ui/DateRangePicker';
import { BarChart } from '../components/charts/BarChart';
import { DonutChart } from '../components/charts/DonutChart';

/* ------------------------------------------------------------------
   SAMPLE DATA — deterministic per date so it doesn't jump on re-render.
   Replace with API calls when Inventory / O2D modules are built.
------------------------------------------------------------------- */
const seeded = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};

const isoDay = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const dayLabel = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' });
const dayFull = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

const buildDaily = (range) =>
  daysInRange(range).map((d) => {
    const r = seeded(isoDay(d));
    return {
      key: isoDay(d),
      label: dayLabel.format(d),
      fullLabel: dayFull.format(d),
      revenue: Math.round((25000 + r * 95000) / 100) * 100,
      orders: Math.round(2 + seeded(`o${isoDay(d)}`) * 10),
    };
  });

const INVENTORY = [
  { label: 'Fabrics', value: 68, color: 'var(--chart-1)' },
  { label: 'Curtains', value: 42, color: 'var(--chart-2)' },
  { label: 'Upholstery', value: 27, color: 'var(--chart-3)' },
  { label: 'Accessories', value: 15, color: 'var(--chart-4)' },
];

const ORDERS = [
  { id: 'FSD-1042', customer: 'Sharma Furnishings', city: 'Jaipur', fabric: 'Velvet Blackout – Wine', meters: 120, amount: 54000, status: 'pending' },
  { id: 'FSD-1041', customer: 'Home Drapes Co.', city: 'Pune', fabric: 'Linen Sheer – Ivory', meters: 85, amount: 31450, status: 'cutting' },
  { id: 'FSD-1040', customer: 'Royal Interiors', city: 'Delhi', fabric: 'Jacquard – Gold Leaf', meters: 60, amount: 42000, status: 'design' },
  { id: 'FSD-1039', customer: 'Comfort Living', city: 'Bengaluru', fabric: 'Cotton Print – Indigo', meters: 150, amount: 37500, status: 'dispatched' },
  { id: 'FSD-1038', customer: 'Decor Point', city: 'Kolkata', fabric: 'Silk Blend – Champagne', meters: 40, amount: 28800, status: 'delivered' },
];

const inr = (n) => `₹${n.toLocaleString('en-IN')}`;
const inrCompact = (n) => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}K`;
  return `₹${n}`;
};

const METRICS = {
  revenue: { label: 'Revenue', format: inr, tick: inrCompact },
  orders: { label: 'Orders', format: (v) => `${v} orders`, tick: (v) => String(Math.round(v)) },
};

export default function Dashboard() {
  const [range, setRange] = useState(() => getRange('last7'));
  const [metric, setMetric] = useState('revenue');

  const daily = useMemo(() => buildDaily(range), [range]);
  const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = daily.reduce((s, d) => s + d.orders, 0);

  const stats = [
    { label: 'Total Inventory', value: '1,248', delta: 12, icon: Boxes, tone: 'gold' },
    { label: 'Low Stock Items', value: '9', delta: -7, icon: TriangleAlert, tone: 'danger' },
    { label: 'New Orders', value: totalOrders.toLocaleString('en-IN'), delta: 18, icon: PackageOpen, tone: 'gold' },
    { label: 'Revenue', value: inrCompact(totalRevenue), delta: 22, icon: IndianRupee, tone: 'success' },
  ];

  const m = METRICS[metric];
  const chartData = daily.map((d) => ({ key: d.key, label: d.label, fullLabel: d.fullLabel, value: d[metric] }));

  return (
    <div className="page">
      {/* Hero banner — text is part of the artwork, so it's in the alt text */}
      <section className="hero">
        <img
          src="/Assets/hero-banner.webp"
          alt="Curtains That Transform Spaces — Premium Quality, Custom Designs, Expert Installation"
          className="hero__img"
        />
        <div className="hero__controls">
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </section>

      <div className="stats">
        {stats.map(({ label, value, delta, icon: Icon, tone }) => (
          <div key={label} className="card stat">
            <div className="stat__top">
              <span className={`stat__icon stat__icon--${tone}`}>
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <p className="stat__label">{label}</p>
            </div>
            <p className="stat__value">{value}</p>
            <div className="stat__foot">
              <span className={`stat__delta ${delta >= 0 ? 'is-up' : 'is-down'}`}>
                {delta >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {delta > 0 ? '+' : ''}
                {delta}%
              </span>
              <Badge variant="neutral" size="sm">
                Sample
              </Badge>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card__head">
            <div>
              <h3>Sales &amp; Revenue</h3>
              <p className="card__sub">
                Daily {m.label.toLowerCase()} · {range.label}
              </p>
            </div>
            <div className="segmented" role="tablist" aria-label="Metric">
              {Object.entries(METRICS).map(([key, def]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={metric === key}
                  className={metric === key ? 'is-active' : ''}
                  onClick={() => setMetric(key)}
                >
                  {def.label}
                </button>
              ))}
            </div>
          </div>
          <BarChart data={chartData} seriesName={m.label} formatValue={m.format} formatTick={m.tick} />
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <h3>Inventory by Category</h3>
              <p className="card__sub">Items in stock</p>
            </div>
            <Badge variant="neutral" size="sm">
              Sample
            </Badge>
          </div>
          <DonutChart data={INVENTORY} centerLabel="Items" />
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <h3>Recent Orders</h3>
          <Badge variant="brand">{ORDERS.length} this week</Badge>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Fabric</th>
                <th className="num">Meters</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ORDERS.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.id}</td>
                  <td>
                    <p className="cell-main">{o.customer}</p>
                    <p className="cell-sub">{o.city}</p>
                  </td>
                  <td>{o.fabric}</td>
                  <td className="num">{o.meters} m</td>
                  <td className="num">{inr(o.amount)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
