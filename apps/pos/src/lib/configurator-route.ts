// Share the same split point between the route and product-card intent. Start
// downloading on hover/focus/touch, while keeping the configurator out of boot.
export const loadConfiguratorRoute = () =>
  import('../pages/Configurator').then((module) => ({ default: module.Configurator }));

export function preloadConfiguratorRoute(): void {
  // Speculative loading must not block a card or leak an unhandled rejection
  // when offline. The route can try again on the actual navigation.
  void loadConfiguratorRoute().catch(() => undefined);
}
