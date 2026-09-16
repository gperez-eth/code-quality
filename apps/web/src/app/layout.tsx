import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import Link from 'next/link';
import { Icon } from '@/components/primitives';
import { ApiProvider } from '@/lib/api';
import { signOut } from './login/actions';
import { currentOrganization } from '@/lib/session';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Code Quality',
  description: 'Code quality analysis for the repositories your team ships',
};

/** The dark utility bar: global navigation, kept out of the workbench below. */
async function AppHeader() {
  const organization = await currentOrganization();

  const modules = ['Projects', 'Issues', 'Rules', 'Quality Gates', 'Administration'];

  return (
    <header className="flex h-12 items-center justify-between border-b border-outline/30 bg-inverse-surface px-4">
      <div className="flex items-center gap-4">
        <Link className="flex items-center gap-1.5" href="/">
          <Icon className="text-[20px] text-tertiary-fixed" name="waves" />
          <span className="text-headline-sm font-semibold text-on-primary">Code Quality</span>
        </Link>
        <nav className="hidden items-center gap-3 xl:flex">
          {modules.map((module, index) => (
            <span
              className={`text-label-md ${index === 0 ? 'font-semibold text-on-primary' : 'text-inverse-on-surface/50'}`}
              key={module}
              // Only the project screens exist so far; the rest are in the design.
              title={index === 0 ? undefined : 'Not built yet'}
            >
              {module}
            </span>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative w-[260px]">
          <Icon
            className="absolute top-1/2 left-2 -translate-y-1/2 text-[16px] text-inverse-on-surface/60"
            name="search"
          />
          <input
            className="h-7 w-full rounded-sm border border-outline/30 bg-surface-container-highest/20 pr-2 pl-7 text-body-sm text-inverse-on-surface placeholder-inverse-on-surface/50 focus:border-primary-container focus:outline-none"
            disabled
            placeholder="Search is not wired up yet"
            type="search"
          />
        </div>
        {organization ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-label-md text-inverse-on-surface/70 sm:inline">{organization.slug}</span>
            <form action={signOut}>
              <button
                aria-label="Sign out"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary transition-opacity hover:opacity-80"
                title="Sign out"
                type="submit"
              >
                <Icon className="text-[18px] text-on-primary" name="logout" />
              </button>
            </form>
          </div>
        ) : (
          <Link className="text-label-md text-inverse-on-surface/70 hover:text-on-primary" href="/login">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} min-h-screen bg-background`}>
        <AppHeader />
        <ApiProvider>{children}</ApiProvider>
      </body>
    </html>
  );
}
