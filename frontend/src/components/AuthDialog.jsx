import { useState } from 'react'
import { Apple, KeyRound } from 'lucide-react'

export default function AuthDialog({ open, purpose = 'general', onClose, onSave }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [method, setMethod] = useState('code')
  if (!open) return null
  function submit(event) {
    event.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Enter a valid email address.'); return }
    onSave({ name: email.split('@')[0], email: email.trim().toLowerCase() })
  }
  function providerUnavailable(provider) { setError(`${provider} sign-in needs a connected OAuth provider. Use email to save a local profile in this browser.`) }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="auth-dialog" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close sign in">×</button>
      <img className="auth-logo-image" src="/depthvision-logo.png" alt="3D DepthVision logo" />
      <p className="auth-welcome">{purpose === 'history' ? 'Login to show history' : 'Welcome to 3D DepthVision'}</p>
      <button className="oauth-button" type="button" onClick={() => providerUnavailable('Google')}><span className="google-mark">G</span> Continue with Google</button>
      <div className="auth-divider"><span>or</span></div>
      <label className="auth-email">Email<input value={email} onChange={event => setEmail(event.target.value)} placeholder="yours@example.com" type="email" autoFocus /></label>
      {method === 'password' && <label>Password<input placeholder="Enter your password" type="password" /></label>}
      <button className="btn btn-primary auth-submit" type="submit"><KeyRound size={17} /> {method === 'password' ? 'Sign in with password' : 'Get code'}</button>
      <button className="auth-method" type="button" onClick={() => setMethod(method === 'code' ? 'password' : 'code')}>{method === 'code' ? 'Use Password' : 'Use email code'}</button>
      <div className="social-row"><button className="apple" type="button" aria-label="Continue with Apple" onClick={() => providerUnavailable('Apple')}><Apple size={28} /></button><button className="facebook" type="button" aria-label="Continue with Facebook" onClick={() => providerUnavailable('Facebook')}><span>f</span></button><button className="discord" type="button" aria-label="Continue with Discord" onClick={() => providerUnavailable('Discord')}><span>⌁</span></button><button className="github" type="button" aria-label="Continue with GitHub" onClick={() => providerUnavailable('GitHub')}><span>⌘</span></button></div>
      {error && <p className="auth-error">{error}</p>}
      <p className="auth-legal">By continuing, you agree to our <a href="#terms">Terms of Use</a> and <a href="#privacy">Privacy Policy</a>. Email login saves a local profile only.</p>
    </form>
  </div>
}
