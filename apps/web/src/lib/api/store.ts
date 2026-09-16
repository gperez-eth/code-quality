import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';

/**
 * A store per request, never a module-level one.
 *
 * On the server a module-level store would be shared by every request in the
 * process, so one visitor's cached projects would be served to the next. The
 * provider makes one and holds it for the life of the browser tab.
 */
export function makeStore() {
  const store = configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
  });

  // Refetch on reconnect and on window focus.
  setupListeners(store.dispatch);

  return store;
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
