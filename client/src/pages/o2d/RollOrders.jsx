import { O2DProvider } from '../../context/O2DContext';
import CutOrders from './CutOrders';

/** O2D › Roll — the same stages as Cut (Order Enquiry → Picking → Cutting → Delivery Note → Packing), without IOC. */
export default function RollOrders() {
  return (
    <O2DProvider type="ROLL">
      <CutOrders />
    </O2DProvider>
  );
}
