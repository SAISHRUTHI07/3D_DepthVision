import { useEffect, useState } from 'react'
import { AlertCircle, Box, RefreshCw, Send, Sparkles, WandSparkles } from 'lucide-react'
import ObjectViewer from './ObjectViewer'

const CATEGORIES = ['Object', 'Vehicle', 'Building', 'Architecture', 'Furniture', 'Product', 'Human', 'Anime', 'Character', 'Animal', 'Fantasy', 'Other']
const STYLES = ['Realistic', 'Stylized', 'Cartoon', 'Low Poly', 'Anime', 'Game Asset', 'Product Visualization', 'Architectural']
const QUALITIES = ['Draft', 'Balanced', 'High', 'Ultra']
const STAGES = { queued: 'Preparing prompt', submitting: 'Generating preview', processing: 'Creating 3D geometry', refining: 'Applying materials', downloading: 'Optimizing and validating model', completed: '3D model generated successfully', failed: 'Generation failed' }

export default function TextTo3DPanel() {
  const [prompt, setPrompt] = useState('')
  const [category, setCategory] = useState('Object')
  const [style, setStyle] = useState('Realistic')
  const [quality, setQuality] = useState('Balanced')
  const [enhancedPrompt, setEnhancedPrompt] = useState('')
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [provider, setProvider] = useState(null)
  const payload = () => ({ prompt: prompt.trim(), category, style, quality })

  useEffect(() => {
    fetch('/api/text3d/status').then(response => response.json()).then(data => setProvider({ ...data, available: data.configured })).catch(() => setProvider({ available: false, message: 'Text-to-3D provider status could not be checked.' }))
  }, [])

  useEffect(() => {
    if (!job?.job_id || ['completed', 'failed'].includes(job.status)) return undefined
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/text-to-3d/${job.job_id}`); const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || 'Generation status could not be retrieved.')
        setJob(data)
      } catch (err) { setError(err.message || 'Generation status could not be retrieved.'); setJob(current => current ? { ...current, status: 'failed' } : current) }
    }, 2500)
    return () => window.clearInterval(poll)
  }, [job?.job_id, job?.status])

  async function enhance() {
    setLoading(true); setError(null)
    try {
      const response = await fetch('/api/text-to-3d/enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }); const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Prompt enhancement failed.')
      setEnhancedPrompt(data.enhanced_prompt)
    } catch (err) { setError(err.message || 'Prompt enhancement failed.') } finally { setLoading(false) }
  }
  async function generate(event) {
    event.preventDefault(); setLoading(true); setError(null); setJob(null)
    try {
      const response = await fetch('/api/text-to-3d', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) }); const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Text-to-3D generation could not start.')
      setEnhancedPrompt(data.enhanced_prompt); setJob(data)
    } catch (err) { setError(err.message || 'Text-to-3D generation could not start.') } finally { setLoading(false) }
  }
  const active = job && !['completed', 'failed'].includes(job.status)
  return <div className="text-to-3d">
    <section className="card-panel text-hero"><div><p className="eyebrow">OPTIONAL PROVIDER EXTENSION</p><h3><Sparkles size={20} /> Text → 3D</h3><p>Generate a real GLB through a configured provider, then inspect it in the existing DepthWizard 3D viewer. No placeholder geometry is created locally.</p></div><Box size={48} /></section>
    {provider && <div className={`provider-status ${provider.available ? 'ready' : ''}`}><strong>{provider.available ? 'Text-to-3D provider ready' : 'Provider setup required'}</strong><span>{provider.message}</span>{!provider.available && <small>Create <code>backend/.env</code> from <code>backend/.env.example</code>, then set your provider URL and key. Keys remain on the backend.</small>}</div>}
    <form className="card-panel text-form" onSubmit={generate}><label className="prompt-label">Describe the 3D model<textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A futuristic blue sports car with aerodynamic body panels" rows="6" maxLength="1000" /></label><div className="text-selectors"><label>Category<select value={category} onChange={event => setCategory(event.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label><label>Style<select value={style} onChange={event => setStyle(event.target.value)}>{STYLES.map(value => <option key={value}>{value}</option>)}</select></label><label>Quality<select value={quality} onChange={event => setQuality(event.target.value)}>{QUALITIES.map(value => <option key={value}>{value}</option>)}</select></label></div><div className="flythrough-controls"><button type="button" className="btn btn-secondary" onClick={enhance} disabled={loading || prompt.trim().length < 2}><WandSparkles size={16} /> Enhance Prompt</button><button className="btn btn-primary" disabled={loading || active || prompt.trim().length < 2}>{loading ? 'Contacting provider…' : <><Send size={16} /> Generate 3D Model</>}</button></div>{enhancedPrompt && <section className="enhanced-prompt"><strong>Enhanced generation prompt</strong><p>{enhancedPrompt}</p></section>}</form>
    {job && <section className={`text-job ${job.status}`}><div><span>Generation progress</span><strong>{STAGES[job.status] || job.status}</strong></div><p>{job.message}</p><div className="job-stages">{['queued', 'submitting', 'processing', 'refining', 'downloading', 'completed'].map(stage => <i className={Object.keys(STAGES).indexOf(stage) <= Object.keys(STAGES).indexOf(job.status) ? 'complete' : ''} key={stage}>{STAGES[stage]}</i>)}</div></section>}
    {error && <div className="state-box error"><AlertCircle size={30} /><h3>Text-to-3D error</h3><p>{error}</p><button className="btn btn-secondary" onClick={generate}><RefreshCw size={16} /> Retry</button></div>}
    {job?.status === 'completed' && <><section className="card-panel"><div className="card-title"><h3>Generated model preview</h3><span className="title-badge">GLB READY</span></div><p className="details-copy">Provider metadata is retained with the job. Download is available in the same viewer controls.</p></section><ObjectViewer textModel={job} /></>}
  </div>
}
