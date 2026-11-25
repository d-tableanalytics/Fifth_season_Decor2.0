import { Link } from 'react-router-dom';
import { ShieldX } from 'lucide-react';
import { Badge } from '../components/ui/Badge';

export default function AccessDenied({ noModules = false }) {
  return (
    <div className="page">
      <div className="card empty">
        <span className="empty__icon empty__icon--danger">
          <ShieldX size={26} />
        </span>
        <Badge variant="danger">403 · Access denied</Badge>
        <h2>{noModules ? 'No modules assigned' : 'You don’t have access to this page'}</h2>
        <p>
          {noModules
            ? 'Your role has no permissions yet. Please ask your administrator to assign access.'
            : 'Ask your administrator to grant this permission to your role.'}
        </p>
        {!noModules && (
          <Link to="/" className="btn btn--secondary btn--md">
            Go to home
          </Link>
        )}
      </div>
    </div>
  );
}
