import { redirect } from 'next/navigation';
import { Icon } from '@/components/primitives';
import { currentOrganization } from '@/lib/session';
import { signInWithGitHub } from './actions';

export const metadata = { title: 'Sign in · Code Quality' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // Already signed in: nothing to do here.
  if (await currentOrganization()) redirect('/');

  const { error } = await searchParams;

  return (
    <main className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-md border border-outline-variant bg-surface-container-lowest p-8">
        <h1 className="text-headline-md text-on-surface">Sign in</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Code Quality analyses the repositories you connect. Signing in with GitHub is also how it is granted access to
          them.
        </p>

        {error ? (
          <p
            className="mt-4 rounded-sm border border-error/40 bg-error-container px-3 py-2 text-body-sm text-on-error-container"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <form action={signInWithGitHub} className="mt-6">
          <button
            className="flex h-10 w-full items-center justify-center gap-2 rounded-sm bg-primary text-label-md text-on-primary transition-opacity hover:opacity-90"
            type="submit"
          >
            <Icon className="text-[18px]" name="code" />
            Continue with GitHub
          </button>
        </form>

        <p className="mt-6 text-body-sm text-on-surface-variant">
          A personal organisation is created on first sign-in. Everything you analyse belongs to it, and nothing is
          visible outside it.
        </p>
      </div>
    </main>
  );
}
