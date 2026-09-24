/** Fail closed before the application imports any API/auth code. */
export function createSimulationFetch(
  nativeFetch: typeof fetch,
  handle: typeof fetch,
  origin: string,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin) {
      throw new Error('Simulation blocked an external request. No live request was sent.');
    }
    if (url.pathname.startsWith('/api/')) return handle(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      throw new Error(`Simulation blocked an unhandled ${method} request.`);
    }
    return nativeFetch(input, init);
  };
}
