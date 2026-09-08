import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

export default function OrcidCallbackPage(){
  const [params]=useSearchParams(); const {profile,refreshProfile}=useAuth(); const [message,setMessage]=useState('Verifying your ORCID…');
  useEffect(()=>{run();},[]);
  async function run(){const code=params.get('code'),state=params.get('state'); if(!code||!state){setMessage('ORCID did not return the required code and state.');return;} const {data,error}=await supabase.functions.invoke('orcid-callback',{body:{code,state}}); if(error)setMessage(error.message); else{await refreshProfile();setMessage(`ORCID ${data?.orcid||''} verified and linked to your RSE profile.`);}}
  return <div className="auth-shell"><div className="card auth-card"><h1>ORCID verification</h1><p>{message}</p>{profile&&<Link className="button primary" to={`/u/${profile.username}`}>Return to profile</Link>}</div></div>
}
