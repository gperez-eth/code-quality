'use client';

import type { SerializedError } from '@reduxjs/toolkit';
import type { SupabaseQueryError } from '@/lib/api';
import { Icon, Panel } from './primitives';

/**
 * The two states server rendering never had to show.
 *
 * Fetching in the browser means a page exists before its data does, and that a
 * request can fail in front of someone. Both get a real panel rather than a
 * blank area, so a slow network and a broken query do not look alike.
 */

/**
 * RTK Query reports either the base query's error or a SerializedError, when
 * something threw rather than returning. Both land here, so both are handled.
 */
export type QueryFailure = SupabaseQueryError | SerializedError;

function describe(error: QueryFailure): { message: string; hint: string | null } {
  if ('hint' in error) return { message: error.message, hint: error.hint };
  return { message: error.message ?? 'Something went wrong.', hint: null };
}

export function QueryLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <Panel className="flex items-center justify-center gap-2 px-4 py-12 text-body-md text-on-surface-variant">
      <Icon className="animate-spin text-[18px]" name="progress_activity" />
      {label}
    </Panel>
  );
}

export function QueryError({ error, onRetry }: { error: QueryFailure; onRetry?: () => void }) {
  const { message, hint } = describe(error);

  return (
    <Panel className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Icon className="text-[28px] text-error" name="error" />
      <p className="text-headline-sm">That did not load</p>
      <p className="max-w-[460px] text-body-md text-on-surface-variant">{message}</p>
      {/* The hint is usually the useful half of a Postgrest error. */}
      {hint ? <p className="max-w-[460px] text-body-sm text-on-surface-variant">{hint}</p> : null}
      {onRetry ? (
        <button
          className="mt-2 h-8 rounded-sm border border-outline px-3 text-label-md text-primary hover:bg-surface-container"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      ) : null}
    </Panel>
  );
}
