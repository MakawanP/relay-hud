import type { AccountId, ProtocolBadge, ProviderKind } from "@/domain/types";

export interface WireEdge {
  id: string;
  jobId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  badge: ProtocolBadge;
  selected: boolean;
  failed: boolean;
}

export interface BusAnchor {
  accountId: AccountId;
  provider: ProviderKind;
  x: number;
  y: number;
  online: boolean;
  autoFailover: boolean;
}
