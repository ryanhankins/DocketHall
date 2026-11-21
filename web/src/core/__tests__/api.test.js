import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, todayIso } from '../api.js';

describe('core/api helpers', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('returns YYYY-MM-DD from todayIso()', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parses JSON response on 200 and throws structured error on failure', async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ status: 'ok' }),
    });
    const ok = await api('/api/health');
    expect(ok).toEqual({ status: 'ok' });

    globalThis.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: async () => ({ detail: 'Invalid slug' }),
    });
    await expect(api('/api/test')).rejects.toThrow(/Invalid slug/i);
  });
});
