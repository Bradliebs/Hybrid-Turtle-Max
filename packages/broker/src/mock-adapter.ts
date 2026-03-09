import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/src/env';
import type {
  BrokerAdapter,
  BrokerInstrumentMeta,
  BrokerOrderSnapshot,
  BrokerPortfolioSnapshot,
  BrokerPositionSnapshot,
  CancelOrderResult,
  PlaceOrderInput,
  PlaceOrderResult,
} from './types';

type MockBrokerState = {
  portfolio: BrokerPortfolioSnapshot;
  positions: Array<Omit<BrokerPositionSnapshot, 'updatedAt'> & { updatedAt: string }>;
  orders: Array<Omit<BrokerOrderSnapshot, 'submittedAt' | 'updatedAt'> & { submittedAt: string; updatedAt: string }>;
  instrumentMeta: BrokerInstrumentMeta[];
};

async function loadMockState(): Promise<MockBrokerState> {
  const filePath = path.resolve(env.BROKER_MOCK_DATA_FILE);
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as MockBrokerState;
}

export class MockBrokerAdapter implements BrokerAdapter {
  readonly adapterName = 'mock';

  async getPortfolio(): Promise<BrokerPortfolioSnapshot> {
    const state = await loadMockState();
    return state.portfolio;
  }

  async getPositions(): Promise<BrokerPositionSnapshot[]> {
    const state = await loadMockState();
    return state.positions.map((position) => ({
      ...position,
      updatedAt: new Date(position.updatedAt),
    }));
  }

  async getOrders(): Promise<BrokerOrderSnapshot[]> {
    const state = await loadMockState();
    return state.orders.map((order) => ({
      ...order,
      submittedAt: new Date(order.submittedAt),
      updatedAt: new Date(order.updatedAt),
    }));
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const acceptedAt = new Date();
    return {
      brokerOrderId: `mock-${input.symbol.toLowerCase()}-${acceptedAt.getTime()}`,
      status: 'PENDING',
      acceptedAt,
      rawPayload: {
        adapter: this.adapterName,
        dryRun: true,
        input,
      },
    };
  }

  async cancelOrder(brokerOrderId: string): Promise<CancelOrderResult> {
    return {
      brokerOrderId,
      status: 'CANCELLED',
      cancelledAt: new Date(),
    };
  }

  async getInstrumentMeta(symbol: string): Promise<BrokerInstrumentMeta | null> {
    const state = await loadMockState();
    return state.instrumentMeta.find((instrument) => instrument.symbol === symbol) ?? null;
  }
}