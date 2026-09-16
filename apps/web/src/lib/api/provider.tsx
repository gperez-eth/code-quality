'use client';

import { useRef, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { makeStore, type AppStore } from './store';

/**
 * Wraps the tree so any client component can call the generated hooks.
 *
 * This being a client component does not drag the pages into the browser:
 * children passed through it are still rendered on the server. What crosses is
 * only the store, for the components that ask for it.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  storeRef.current ??= makeStore();

  return <Provider store={storeRef.current}>{children}</Provider>;
}
