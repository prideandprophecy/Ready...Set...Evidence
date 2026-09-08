import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

export default function AuthPage(){
  const {user}=useAuth(); const location=useLocation(); const [mode,setMode]=useState('signin'); const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [displayName,setDisplayName]=useState(''); const [message,setMessage]=useState(''); const [busy,setBusy]=useState(false);
  if(user) return <Navigate to={location.state?.from||'/'} replace/>;
  async function submit(e){e.preventDefault();setBusy(true);setMessage('');
    if(mode==='signup'){
      const {error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName}}});
      setMessage(error?error.message:'Account created. If email confirmation is enabled, check your email before signing in.');
    } else {
      const {error}=await supabase.auth.signInWithPassword({email,password}); if(error)setMessage(error.message);
    } setBusy(false);
  }
  return <div className="auth-shell"><div className="card auth-card"><div className="eyebrow">Contributor identity</div><h1>{mode==='signin'?'Sign in':'Create your RSE profile'}</h1><p className="muted">Your public profile links your evidence contributions, appraisals, reviews, verified papers, organizations, followers, and contribution metrics.</p>
    <form className="form-stack" onSubmit={submit}>{mode==='signup'&&<label>Display name<input required value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>}<label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" minLength="8" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy} className="button primary">{busy?'Working…':mode==='signin'?'Sign in':'Create profile'}</button></form>
    {message&&<div className="notice">{message}</div>}<button className="button text" onClick={()=>setMode(mode==='signin'?'signup':'signin')}>{mode==='signin'?'Need a profile? Create one':'Already have a profile? Sign in'}</button>
  </div></div>
}
