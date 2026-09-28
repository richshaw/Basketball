import { createContext, useContext } from 'react';

/** App-update state from the service worker (see ServiceWorkerProvider). */
export interface ServiceWorkerUpdate {
  /** A new version has been downloaded and is waiting to take over. */
  needRefresh: boolean;
  /** Switches to the waiting version; the page reloads once it takes control. */
  update: () => Promise<void>;
  /** Hides the prompt for now; it comes back on the next launch. */
  dismiss: () => void;
}

/** Used when no provider is mounted (and as a base for test overrides). */
export const noServiceWorkerUpdate: ServiceWorkerUpdate = {
  needRefresh: false,
  update: () => Promise.resolve(),
  dismiss: () => {},
};

export const ServiceWorkerContext = createContext<ServiceWorkerUpdate>(noServiceWorkerUpdate);

export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  return useContext(ServiceWorkerContext);
}
