import { describe, expect, it, vi } from 'vitest';
import { deliverNightlyNotification } from './nightly-notification';

describe('nightly notification tracking', () => {
  it('leaves a successfully delivered step healthy', async () => {
    const failed = vi.fn();
    expect(await deliverNightlyNotification(async () => true, failed)).toBe(true);
    expect(failed).not.toHaveBeenCalled();
  });

  it('records a false result and returns so heartbeat writing can continue', async () => {
    const failed = vi.fn();
    expect(await deliverNightlyNotification(async () => false, failed)).toBe(false);
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('not delivered'));
  });

  it('records a thrown failure without throwing or exposing error secrets', async () => {
    const failed = vi.fn();
    expect(await deliverNightlyNotification(async () => { throw new Error('secret-url'); }, failed)).toBe(false);
    expect(failed).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('threw an error'));
    expect(failed.mock.calls[0][0]).not.toContain('secret-url');
  });
});