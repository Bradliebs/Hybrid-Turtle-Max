import type { AssetType, BrokerOrderStatus, BrokerOrderType, TradeSide } from '@prisma/client';

export interface BrokerPortfolioSnapshot {
  accountId: string;
  accountType: string;
  currency: string;
  cashBalance: number;
  equity: number;
  buyingPower?: number | null;
  totalMarketValue?: number | null;
  dailyPnl?: number | null;
}

export interface BrokerPositionSnapshot {
  brokerPositionId: string;
  accountId: string;
  accountType: string;
  symbol: string;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  currency?: string | null;
  updatedAt: Date;
}

export interface BrokerOrderSnapshot {
  brokerOrderId: string;
  accountId: string;
  accountType: string;
  symbol: string;
  side: TradeSide;
  orderType: BrokerOrderType;
  status: BrokerOrderStatus;
  quantity: number;
  filledQuantity?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  averageFillPrice?: number | null;
  submittedAt: Date;
  updatedAt: Date;
}

export interface BrokerInstrumentMeta {
  symbol: string;
  brokerInstrumentId: string;
  name: string;
  exchange: string;
  currency: string;
  assetType: AssetType;
  tradable: boolean;
}

export interface PlaceOrderInput {
  symbol: string;
  side: TradeSide;
  orderType: BrokerOrderType;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
}

export interface PlaceOrderResult {
  brokerOrderId: string;
  status: BrokerOrderStatus;
  acceptedAt: Date;
  rawPayload: Record<string, unknown>;
}

export interface CancelOrderResult {
  brokerOrderId: string;
  status: BrokerOrderStatus;
  cancelledAt: Date;
}

export interface BrokerAdapter {
  readonly adapterName: string;
  getPortfolio(): Promise<BrokerPortfolioSnapshot>;
  getPositions(): Promise<BrokerPositionSnapshot[]>;
  getOrders(): Promise<BrokerOrderSnapshot[]>;
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  cancelOrder(brokerOrderId: string): Promise<CancelOrderResult>;
  getInstrumentMeta(symbol: string): Promise<BrokerInstrumentMeta | null>;
}

export interface BrokerSyncResult {
  runId: string;
  positionsCount: number;
  ordersCount: number;
  discrepancyCount: number;
  newLocalPositions: string[];
  closedLocalPositions: string[];
  discrepancies: Array<Record<string, unknown>>;
}