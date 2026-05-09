import {
  Inbox,
  Send,
  Forklift,
  PackageCheck,
  Truck,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import type { OrderLane } from './queries';

export interface LaneDef {
  id: Exclude<OrderLane, 'cancelled'>;
  num: string;
  title: string;
  sub: string;
  Icon: LucideIcon;
  terminal?: boolean;
}

export const LANES: ReadonlyArray<LaneDef> = [
  { id: 'received',   num: '01', title: 'Received',           sub: 'New from POS',          Icon: Inbox },
  { id: 'proceed',    num: '02', title: 'Proceed requested',  sub: 'Slip + customer ready', Icon: Send },
  { id: 'logistics',  num: '03', title: 'Awaiting logistics', sub: 'PO & supplier coord',   Icon: Forklift },
  { id: 'ready',      num: '04', title: 'Ready to dispatch',  sub: 'Goods in, scheduled',   Icon: PackageCheck },
  { id: 'dispatched', num: '05', title: 'Dispatched',         sub: 'Driver assigned, OTW',  Icon: Truck },
  { id: 'delivered',  num: '06', title: 'Delivered',          sub: 'Signed, complete',      Icon: CheckCircle2, terminal: true },
] as const;

export type LaneId = LaneDef['id'];

export const isLaneId = (s: string): s is LaneId =>
  LANES.some((l) => l.id === s);
