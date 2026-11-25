import { useSearchParams } from 'react-router-dom';
import { Wallet, PackageSearch } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import PaymentCheck from './PaymentCheck';
import StockCheck from './StockCheck';

const STAGES = [
  { key: 'payment', label: 'Payment Check', icon: Wallet, perm: 'crm_payment_check', Comp: PaymentCheck },
  { key: 'stock', label: 'Stock Check', icon: PackageSearch, perm: 'crm_stock_check', Comp: StockCheck },
];

/** CRM › Cut / Roll — one tab per CRM stage the user can view. */
function CrmOrders({ type }) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const stages = STAGES.filter((s) => can(s.perm));
  const active = stages.find((s) => s.key === params.get('stage')) || stages[0];
  const label = type === 'CUT' ? 'Cut' : 'Roll';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">{label} Orders</h2>
          <p className="page-header__sub">CRM › {label}</p>
        </div>
      </div>

      <div className="stage-tabs" role="tablist" aria-label="CRM stage">
        {stages.map(({ key, label: l, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={active.key === key}
            className={`stage-tab ${active.key === key ? 'is-active' : ''}`}
            onClick={() => setParams({ stage: key }, { replace: true })}
          >
            <Icon size={15} /> {l}
          </button>
        ))}
      </div>

      {active && <active.Comp key={`${type}-${active.key}`} type={type} />}
    </div>
  );
}

export const CrmCut = () => <CrmOrders type="CUT" />;
export const CrmRoll = () => <CrmOrders type="ROLL" />;
