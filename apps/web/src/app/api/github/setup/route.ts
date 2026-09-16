import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Where GitHub sends the browser back after installing the app.
 *
 * This is the setup URL configured on the app. It carries `installation_id`
 * and the `state` we minted — and nothing else that could be trusted, which is
 * why the deciding happens in `claim_github_install` rather than here. All
 * three checks live there, next to the data: the state was ours, GitHub told
 * us who installed it, and the installation is not already somebody else's.
 *
 * Every failure comes back as a message on the repositories page rather than a
 * raw 4xx: the person is in a browser, halfway through connecting an account,
 * and a status code is not an answer to "what do I do now".
 */

function home(origin: string, params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params);
  return NextResponse.redirect(`${origin}/?${query.toString()}`);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { origin, searchParams } = new URL(request.url);

  const installationId = Number(searchParams.get('installation_id'));
  const state = searchParams.get('state') ?? '';

  // Someone without permission to install on an organisation can only *request*
  // it. There is no installation yet, so there is nothing to claim — and coming
  // back with an error would misdescribe what just happened.
  if (searchParams.get('setup_action') === 'request') {
    return home(origin, { github: 'requested' });
  }

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return home(origin, { github_error: 'GitHub did not say which installation this was.' });
  }

  if (state === '') {
    return home(origin, {
      github_error: 'That installation did not start from here. Use the Install button and try again.',
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('claim_github_install', {
    p_nonce: state,
    p_installation_id: installationId,
  });

  if (error) return home(origin, { github_error: error.message });
  return home(origin, { github: 'connected' });
}
