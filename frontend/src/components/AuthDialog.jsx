import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'

export default function AuthDialog({ open, onClose, onSave }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  if (!open) return null
  function submit(event) {
    event.preventDefault()
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) { setError('Enter your name and a valid email address.'); return }
    onSave({ name: name.trim(), email: email.trim().toLowerCase() })
  }
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="auth-dialog" onSubmit={submit} onMouseDown={event => event.stopPropagation()}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close sign in">×</button>
      <ShieldCheck className="auth-icon" size={28} />
      <p className="eyebrow">DEPTHVISION PROFILE</p>
      <h3>Save your project history</h3>
      <p className="dialog-copy">This lightweight profile is saved only in this browser on this computer. No data is sent to a third party.</p>
      <label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" autoFocus /></label>
      <label>Email<input value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" type="email" /></label>
      {error && <p className="auth-error">{error}</p>}
      <button className="btn btn-primary" type="submit">Sign in locally</button>
    </form>
  </div>
}
