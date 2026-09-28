import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import {
  noServiceWorkerUpdate,
  ServiceWorkerContext,
  type ServiceWorkerUpdate,
} from '@/pwa/serviceWorkerContext';
import { appRoutes } from '@/router';

export interface RenderRouteOptions {
  /** Fake app-update state, e.g. `{ needRefresh: true }`. */
  serviceWorker?: Partial<ServiceWorkerUpdate>;
}

/** Renders the whole app at `path` (e.g. `paths.stats`) with an in-memory router. */
export function renderRoute(path: string, { serviceWorker }: RenderRouteOptions = {}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(
    <ServiceWorkerContext value={{ ...noServiceWorkerUpdate, ...serviceWorker }}>
      <RouterProvider router={router} />
    </ServiceWorkerContext>,
  );
  return { ...view, router, user };
}

/** Renders one component inside a router (for components that use Link/NavLink). */
export function renderWithRouter(ui: ReactElement, { path = '/' }: { path?: string } = {}) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(<RouterProvider router={router} />);
  return { ...view, router, user };
}
