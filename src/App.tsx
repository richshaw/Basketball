import { RouterProvider } from 'react-router/dom';
import { UiProviders } from '@/components/UiProviders/UiProviders';
import { ServiceWorkerProvider } from '@/pwa/ServiceWorkerProvider';
import { createAppRouter } from '@/router';

const router = createAppRouter();

export function App() {
  return (
    <ServiceWorkerProvider>
      <UiProviders>
        <RouterProvider router={router} />
      </UiProviders>
    </ServiceWorkerProvider>
  );
}
