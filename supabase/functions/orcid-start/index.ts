import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw new Error('Authentication required.');

    const state = crypto.randomUUID();
    const appOrigin = (Deno.env.get('APP_ORIGIN') || '').replace(/\/$/, '');
    if (!appOrigin) throw new Error('APP_ORIGIN is not configured.');
    const redirectUri = `${appOrigin}/orcid/callback`;
    const admin = createClient(supabaseUrl, serviceKey);
    const { error } = await admin.from('rse_oauth_states').insert({
      state, user_id: user.id, provider: 'orcid', redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw error;

    const base = (Deno.env.get('ORCID_BASE_URL') || 'https://orcid.org').replace(/\/$/, '');
    const clientId = Deno.env.get('ORCID_CLIENT_ID');
    if (!clientId) throw new Error('ORCID_CLIENT_ID is not configured.');
    const params = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: '/authenticate', redirect_uri: redirectUri, state });
    return new Response(JSON.stringify({ url: `${base}/oauth/authorize?${params.toString()}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
