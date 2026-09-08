import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { code, state } = await req.json();
    if (!code || !state) throw new Error('Missing ORCID code or state.');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw new Error('Authentication required.');
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: oauthState, error: stateError } = await admin.from('rse_oauth_states').select('*').eq('state', state).single();
    if (stateError || !oauthState) throw new Error('Invalid OAuth state.');
    if (oauthState.user_id !== user.id) throw new Error('OAuth state belongs to a different user.');
    if (oauthState.used_at) throw new Error('OAuth state has already been used.');
    if (new Date(oauthState.expires_at).getTime() < Date.now()) throw new Error('OAuth state expired.');

    const base = (Deno.env.get('ORCID_BASE_URL') || 'https://orcid.org').replace(/\/$/, '');
    const body = new URLSearchParams({
      client_id: Deno.env.get('ORCID_CLIENT_ID') || '',
      client_secret: Deno.env.get('ORCID_CLIENT_SECRET') || '',
      grant_type: 'authorization_code', code, redirect_uri: oauthState.redirect_uri,
    });
    const tokenResponse = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.orcid) throw new Error(token.error_description || token.error || 'ORCID token exchange failed.');

    const { error: updateError } = await admin.from('rse_profiles').update({ orcid: token.orcid, orcid_verified_at: new Date().toISOString() }).eq('id', user.id);
    if (updateError) throw updateError;
    await admin.from('rse_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state);
    return new Response(JSON.stringify({ orcid: token.orcid, name: token.name || null }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
