import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type PushRequest = {
  userId?: string;
  title?: string;
  body?: string;
  url?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const vapidPublicKey = Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivateKey = Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY') ?? '';
  const vapidSubject = Deno.env.get('WEB_PUSH_VAPID_SUBJECT') ?? 'mailto:hygportal@gmail.com';
  const internalSecret = Deno.env.get('WEB_PUSH_INTERNAL_SECRET') ?? '';

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return json({ error: 'Web Push is not configured.' }, 500);
  }

  const input = await request.json().catch(() => ({})) as PushRequest;
  const requestSecret = request.headers.get('x-web-push-secret') ?? '';
  const isInternalRequest = Boolean(internalSecret) && requestSecret === internalSecret;
  let targetUserId = input.userId ?? '';

  if (!isInternalRequest) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const supabaseForAuth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authError,
    } = await supabaseForAuth.auth.getUser();

    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    targetUserId = targetUserId || user.id;

    if (targetUserId !== user.id) {
      return json({ error: 'Sending to another user is not allowed from the public client.' }, 403);
    }
  }

  if (!targetUserId) {
    return json({ error: 'Missing target user.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: subscriptions, error } = await admin
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', targetUserId)
    .eq('enabled', true);

  if (error) {
    return json({ error: error.message }, 500);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title: input.title || 'HYG Portal',
    body: input.body || 'You have a new HYG Portal alert.',
    url: input.url || '/',
  });
  let sent = 0;
  let failed = 0;

  await Promise.all((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, payload);
      sent += 1;
    } catch (sendError) {
      failed += 1;
      const statusCode = typeof sendError === 'object' && sendError && 'statusCode' in sendError
        ? Number((sendError as { statusCode?: number }).statusCode)
        : 0;

      if (statusCode === 404 || statusCode === 410) {
        await admin.from('web_push_subscriptions').delete().eq('id', subscription.id);
      }
    }
  }));

  return json({ sent, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
