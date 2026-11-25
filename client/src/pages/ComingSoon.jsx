import { useLocation } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { ALL_NAV_ITEMS } from '../components/layout/navConfig';
import { Badge } from '../components/ui/Badge';

export default function ComingSoon() {
  const { pathname } = useLocation();
  const item = ALL_NAV_ITEMS.find((i) => pathname.startsWith(i.to));
  const Icon = item?.icon || Construction;

  return (
    <div className="page">
      <div className="card empty">
        <span className="empty__icon">
          <Icon size={28} />
        </span>
        <Badge variant="info">Coming soon</Badge>
        <h2>{item?.label || 'This page'}</h2>
        <p>This module will be built in an upcoming step.</p>
      </div>
    </div>
  );
}
