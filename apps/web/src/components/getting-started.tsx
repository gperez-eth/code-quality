import { Icon, Panel } from './primitives';

interface Step {
  title: string;
  detail: string;
  command?: string;
}

const CONNECT_STEPS: Step[] = [
  {
    title: 'Create a Supabase project',
    detail:
      'Then copy apps/web/.env.example to apps/web/.env — Next.js only reads env files from its own directory — and fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, both from Project Settings -> API. There is no database password to find: nothing connects to Postgres directly.',
  },
  {
    title: 'Create the tables',
    detail: 'Applies the migrations in supabase/migrations to the linked project.',
    command: 'npm run db:push',
  },
  {
    title: 'Enable GitHub sign-in',
    detail:
      'Authentication -> Providers -> GitHub in the Supabase dashboard, with the callback URL it shows there. Signing in is what creates your organisation, and everything you analyse belongs to it.',
  },
  {
    title: 'Start the analysis worker',
    detail:
      'Nothing gets analysed without it. The dashboard only queues work; this is what clones repositories and runs the analyzer. It needs SUPABASE_SERVICE_ROLE_KEY, which goes in the root .env and which the dashboard must not have.',
    command: 'npm run worker',
  },
  {
    title: 'Connect a repository',
    detail:
      'Reload this page and point the tool at a repository on GitHub or GitLab. The request is queued, the worker picks it up, and the dialog follows it until it finishes.',
  },
];

const SCAN_STEPS: Step[] = [
  {
    title: 'No analysis has finished yet',
    detail:
      'Use "Analyse again" to queue one — and check the worker is running, because nothing happens without it. From the command line, the analyzer publishes a report without going through the dashboard at all.',
    command: 'npm run scan -- . --json report.json && npm run publish -- report.json --org <slug>',
  },
];

/**
 * The first screen anyone sees on a fresh install, so it is the install
 * instructions rather than an apology for having no data.
 */
export function GettingStarted({ reason }: { reason: 'no-database' | 'no-analysis' }) {
  const steps = reason === 'no-database' ? CONNECT_STEPS : SCAN_STEPS;

  return (
    <main className="mx-auto max-w-[760px] px-4 py-10">
      <Panel className="p-6">
        <div className="mb-5 flex items-start gap-3">
          <Icon className="mt-px text-[22px] text-primary-container" name="rocket_launch" />
          <div>
            <h1 className="text-headline-md">
              {reason === 'no-database' ? 'Connect a database' : 'No analysis published yet'}
            </h1>
            <p className="mt-1 text-body-md text-on-surface-variant">
              {reason === 'no-database'
                ? 'The dashboard reads analyses through the Supabase API. Point it at your project and publish a scan.'
                : 'The project is connected and empty. Run a scan and publish it, and this becomes the project overview.'}
            </p>
          </div>
        </div>

        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li className="flex gap-3" key={step.title}>
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-label-sm text-on-surface-variant">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-lg font-medium">{step.title}</p>
                <p className="text-body-sm text-on-surface-variant">{step.detail}</p>
                {step.command ? (
                  <pre className="mt-1.5 overflow-x-auto rounded-xs border border-outline-variant bg-surface-container-low px-2.5 py-1.5 font-mono text-code-body text-on-surface">
                    {step.command}
                  </pre>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
    </main>
  );
}
