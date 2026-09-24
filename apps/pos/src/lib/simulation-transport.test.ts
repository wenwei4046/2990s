import { describe, expect, it, vi } from 'vitest';
import { createSimulationFetch } from './simulation-transport';

describe('simulation network isolation', () => {
  const setup = () => {
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('asset'));
    const simulated = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    return { network, simulated, request: createSimulationFetch(network, simulated, 'http://127.0.0.1:6288') };
  };
  it('routes order creation, payment, cart and authentication exclusively to the simulator', async () => {
    const { network, simulated, request } = setup();
    for (const path of ['/api/scm/mfg-sales-orders', '/api/scm/mfg-sales-orders/demo/payments', '/api/scm/pos-cart', '/api/pos/verify-pin']) {
      await request(path, { method: 'POST', body: '{}' });
    }
    expect(simulated).toHaveBeenCalledTimes(4);
    expect(network).not.toHaveBeenCalled();
  });
  it('blocks every external destination, even reads and Request objects', async () => {
    const { network, simulated, request } = setup();
    await expect(request('https://pos.2990shome.com/api')).rejects.toThrow('external request');
    await expect(request(new Request('https://erp.houzscentury.com/api/scm/mfg-sales-orders', { method: 'POST' }))).rejects.toThrow('external request');
    expect(network).not.toHaveBeenCalled();
    expect(simulated).not.toHaveBeenCalled();
  });
  it('permits local art while refusing unhandled writes', async () => {
    const { network, request } = setup();
    await request('/sofa-modules/2S.svg');
    expect(network).toHaveBeenCalledTimes(1);
    await expect(request('/unexpected', { method: 'PUT' })).rejects.toThrow('unhandled PUT');
    expect(network).toHaveBeenCalledTimes(1);
  });
});
