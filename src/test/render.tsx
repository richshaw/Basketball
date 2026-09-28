import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { UiProviders } from '@/components/UiProviders/UiProviders';
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
      <UiProviders>
        <RouterProvider router={router} />
      </UiProviders>
    </ServiceWorkerContext>,
  );
  return { ...view, router, user };
}

/**
 * Renders one component inside a router (for components that use Link/NavLink).
 * Like the app, it also provides useToast() and useConfirm().
 */
export function renderWithRouter(ui: ReactElement, { path = '/' }: { path?: string } = {}) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [path] });
  const user = userEvent.setup();
  const view = render(
    <UiProviders>
      <RouterProvider router={router} />
    </UiProviders>,
  );
  return { ...view, router, user };
}
