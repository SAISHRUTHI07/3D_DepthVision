import { useEffect, useState } from 'react'
import { AlertCircle, Box, RefreshCw, Send, Sparkles, WandSparkles } from 'lucide-react'
import ObjectViewer from './ObjectViewer'

const CATEGORIES = ['Object', 'Character', 'Vehicle', 'Building', 'Furniture', 'Animal', 'Product', 'Fantasy', 'Other']
const STYLES = ['Realistic', 'Stylized', 'Cartoon', 'Low Poly', 'Anime', 'Fantasy', 'Sci-Fi']
const QUALITIES = ['Draft', 'Balanced', 'High']
const STAGES = { preparing: 'Preparing', generating: 'Generating', processing: 'Processing', downloading: 'Downloading model', validating: 'Validating model', completed: 'Ready', failed: 'Generation failed' }
const STAGE_ORDER = ['preparing', 'generating', 'processing', 'downloading', 'validating', 'completed']

function requestMessage(error, fallback) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'The request timed out. Check the backend/provider connection and retry.'
  if (error instanceof TypeError && /fetch|network|load/i.test(error.message || '')) return 'Backend is offline. Start FastAPI at http://127.0.0.1:8000 and try again.'
  return error?.message || fallback
}

export default function TextTo3DPanel() {
  const [prompt, setPrompt] = useState('')
  const [category, setCategory] = useState('Object')
  const [style, setStyle] = useState('Realistic')
  const [quality, setQuality] = useState('Balanced')
  const [enhancedPrompt, setEnhancedPrompt] = useState('')
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [engine, setEngine] = useState(null)
  const payload = () => ({ prompt: prompt.trim(), category, style, quality })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/text3d/status', { signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || 'Text-to-3D engine status could not be checked.')
        setEngine({ ...data, available: Boolean(data.configured && data.provider_available) })
      })
      .catch(requestError => {
        if (requestError.name !== 'AbortError') setEngine({ available: false, message: requestMessage(requestError, 'Text-to-3D engine status could not be checked.') })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!job?.job_id || ['completed', 'failed'].includes(job.status)) return undefined
    const controller = new AbortController()
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/text3d/status/${job.job_id}`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.detail || 'Generation status could not be retrieved.')
        setJob(data)
      } catch (pollError) {
        if (pollError.name !== 'AbortError') {
          setError(requestMessage(pollError, 'Generation status could not be retrieved.'))
          setJob(current => current ? { ...current, status: 'failed' } : current)
        }
      }
    }, 2500)
    return () => { controller.abort(); window.clearInterval(poll) }
  }, [job?.job_id, job?.status])

  async function enhance() {
    setLoading(true); setError(null)
    try {
      const response = await fetch('/api/text3d/enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()), signal: AbortSignal.timeout(15000) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Prompt enhancement failed.')
      setEnhancedPrompt(data.enhanced_prompt)
    } catch (requestError) { setError(requestMessage(requestError, 'Prompt enhancement failed.')) } finally { setLoading(false) }
  }

  async function generate(event) {
    event.preventDefault(); setLoading(true); setError(null); setJob(null)
    try {
      const response = await fetch('/api/text3d/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()), signal: AbortSignal.timeout(20000) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Text-to-3D generation could not start.')
      setEnhancedPrompt(data.enhanced_prompt); setJob(data)
    } catch (requestError) { setError(requestMessage(requestError, 'Text-to-3D generation could not start.')) } finally { setLoading(false) }
  }

  const active = job && !['completed', 'failed'].includes(job.status)
  const currentStage = STAGE_ORDER.indexOf(job?.status)
  return <div className="text-to-3d">
    <section className="card-panel text-hero"><div><p className="eyebrow">REAL GLB GENERATION</p><h3><Sparkles size={20} /> Text → 3D</h3><p>Describe an asset, enhance its prompt, then generate a provider-produced GLB that is validated for actual mesh geometry before it opens in the existing 3D viewer.</p></div><Box size={48} /></section>
    {engine && <div className={`provider-status ${engine.available ? 'ready' : ''}`}><strong>{engine.available ? 'Text-to-3D engine ready' : 'Text-to-3D setup required'}</strong><span>{engine.message}</span>{!engine.available && <small>{engine.required || 'Configure a compatible provider on the FastAPI backend. No API key is exposed in this browser.'}</small>}</div>}
    <form className="card-panel text-form" onSubmit={generate}><label className="prompt-label">Describe the 3D model you want to create<textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A realistic futuristic electric motorcycle with detailed wheels, metallic body, headlights and realistic proportions." rows="6" maxLength="1000" /></label><div className="text-selectors"><label>Category<select value={category} onChange={event => setCategory(event.target.value)}>{CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label><label>Style<select value={style} onChange={event => setStyle(event.target.value)}>{STYLES.map(value => <option key={value}>{value}</option>)}</select></label><label>Quality<select value={quality} onChange={event => setQuality(event.target.value)}>{QUALITIES.map(value => <option key={value}>{value}</option>)}</select></label></div><div className="flythrough-controls"><button type="button" className="btn btn-secondary" onClick={enhance} disabled={loading || prompt.trim().length < 4}><WandSparkles size={16} /> Enhance Prompt</button><button className="btn btn-primary" disabled={loading || active || !engine?.available || prompt.trim().length < 4}>{loading ? 'Contacting engine…' : <><Send size={16} /> Generate 3D Model</>}</button></div>{enhancedPrompt && <section className="enhanced-prompt"><strong>Enhanced generation prompt</strong><p>{enhancedPrompt}</p></section>}</form>
    {job && <section className={`text-job ${job.status}`}><div><span>Generation progress</span><strong>{STAGES[job.status] || job.status}</strong></div><p>{job.message}</p><div className="job-stages">{STAGE_ORDER.map((stage, index) => <i className={index <= currentStage ? 'complete' : ''} key={stage}>{STAGES[stage]}</i>)}</div></section>}
    {error && <div className="state-box error"><AlertCircle size={30} /><h3>Text-to-3D error</h3><p>{error}</p><button className="btn btn-secondary" onClick={generate} disabled={!engine?.available}><RefreshCw size={16} /> Retry</button></div>}
    {job?.status === 'completed' && <><section className="card-panel"><div className="card-title"><h3>Generated model preview</h3><span className="title-badge">VALIDATED GLB</span></div><p className="details-copy">The provider-returned GLB contains validated mesh geometry. Rotate, zoom, pan, fullscreen, and download it in the existing viewer below.</p></section><ObjectViewer textModel={job} /></>}
  </div>
}
