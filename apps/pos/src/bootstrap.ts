import { IS_SIMULATION } from './lib/simulation-mode';

async function start() {
  if (IS_SIMULATION) {
    const { handleSimulationRequest } = await import('./simulation/api');
    const { createSimulationFetch } = await import('./lib/simulation-transport');
    window.fetch = createSimulationFetch(window.fetch.bind(window), handleSimulationRequest, location.origin);
    const { setHouzsToken, setHouzsStaffId } = await import('./lib/houzsSession');
    setHouzsToken('local-simulation-no-server-credential');
    setHouzsStaffId('demo-sales');
    document.documentElement.dataset.simulation = 'true';
    document.title = "2990 POS · Local simulation";
  }
  await import('./main');
}

void start().catch((error: unknown) => {
  const root = document.getElementById('root');
  if (root) root.textContent = error instanceof Error ? error.message : 'Unable to start POS.';
});
