import { RouterProvider } from 'react-router/dom';
import { ServiceWorkerProvider } from '@/pwa/ServiceWorkerProvider';
import { createAppRouter } from '@/router';

const router = createAppRouter();

export function App() {
  return (
    <ServiceWorkerProvider>
      <RouterProvider router={router} />
    </ServiceWorkerProvider>
  );
}
