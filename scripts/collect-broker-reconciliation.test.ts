import { describe, expect, it, vi } from 'vitest';
import { makeReadOnlyBrokerFetch } from './collect-broker-reconciliation';

describe('read-only broker collection boundary', () => {
  it.each([
    ['https://other.example/api/v0/equity/history/orders', 'GET'],
    ['https://demo.trading212.com/api/v0/equity/history/orders', 'GET'],
    ['https://live.trading212.com/api/v0/equity/orders/stop', 'POST'],
    ['https://live.trading212.com/api/v0/equity/orders/123', 'DELETE'],
    ['https://live.trading212.com/api/v0/equity/history/orders', 'POST'],
    ['https://user:secret@live.trading212.com/api/v0/equity/history/orders', 'GET'],
  ])('blocks %s %s without transport', async (url, method) => {
    const transport = vi.fn<typeof fetch>();
    const guard = makeReadOnlyBrokerFetch(transport);
    await expect(guard.fetch(url, { method })).rejects.toThrow('READ_ONLY_ENDPOINT_REQUIRED');
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves raw fill identity and continuation while disallowing redirects', async () => {
    const page = { items: [{ fill: { id: 123 } }], nextPagePath: '/api/v0/equity/history/orders?cursor=456' };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(page)));
    const guard = makeReadOnlyBrokerFetch(transport, 1);
    const url = 'https://live.trading212.com/api/v0/equity/history/orders?limit=50';
    await guard.fetch(url);
    expect(guard.pages).toEqual([page]);
    expect(guard.requests).toBe(1);
    expect(transport.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
    await expect(guard.fetch(url)).rejects.toThrow('REQUEST_BUDGET_EXHAUSTED');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not count a failed response as a completed page', async () => {
    const guard = makeReadOnlyBrokerFetch(vi.fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 403 })));
    await guard.fetch('https://live.trading212.com/api/v0/equity/history/orders');
    expect(guard.pages).toEqual([]);
  });
});