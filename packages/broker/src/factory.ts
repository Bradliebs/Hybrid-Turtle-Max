import { env } from '../../config/src/env';
import { MockBrokerAdapter } from './mock-adapter';
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

class Trading212BrokerAdapter implements BrokerAdapter {
  readonly adapterName = 'trading212';

  private notConfigured(): never {
    throw new Error('Trading 212 adapter is not configured in this workspace. Set BROKER_ADAPTER=mock or implement live credentials before using trading212.');
  }

  async getPortfolio(): Promise<BrokerPortfolioSnapshot> {
    this.notConfigured();
  }

  async getPositions(): Promise<BrokerPositionSnapshot[]> {
    this.notConfigured();
  }

  async getOrders(): Promise<BrokerOrderSnapshot[]> {
    this.notConfigured();
  }

  async placeOrder(_input: PlaceOrderInput): Promise<PlaceOrderResult> {
    this.notConfigured();
  }

  async cancelOrder(_brokerOrderId: string): Promise<CancelOrderResult> {
    this.notConfigured();
  }

  async getInstrumentMeta(_symbol: string): Promise<BrokerInstrumentMeta | null> {
    this.notConfigured();
  }
}

// No-op adapter that returns empty data — used when broker is not connected
class DisabledBrokerAdapter implements BrokerAdapter {
  readonly adapterName = 'disabled';

  async getPortfolio(): Promise<BrokerPortfolioSnapshot> {
    return {
      accountId: 'disabled',
      accountType: 'DISABLED',
      currency: 'GBP',
      cashBalance: 0,
      equity: 0,
      buyingPower: 0,
      totalMarketValue: 0,
      dailyPnl: 0,
    };
  }

  async getPositions(): Promise<BrokerPositionSnapshot[]> { return []; }
  async getOrders(): Promise<BrokerOrderSnapshot[]> { return []; }

  async placeOrder(): Promise<PlaceOrderResult> {
    throw new Error('Broker adapter is disabled. Connect Trading 212 in Settings before placing orders.');
  }

  async cancelOrder(): Promise<CancelOrderResult> {
    throw new Error('Broker adapter is disabled. Connect Trading 212 in Settings before cancelling orders.');
  }

  async getInstrumentMeta(): Promise<BrokerInstrumentMeta | null> { return null; }
}

export function getBrokerAdapter(): BrokerAdapter {
  if (env.BROKER_ADAPTER === 'trading212') {
    return new Trading212BrokerAdapter();
  }

  if (env.BROKER_ADAPTER === 'disabled') {
    return new DisabledBrokerAdapter();
  }

  return new MockBrokerAdapter();
}