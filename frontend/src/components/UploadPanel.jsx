import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Image, Plus, Trash2, UploadCloud, View } from 'lucide-react'

const ALLOWED = ['image/jpeg', 'image/png']
const MAX_MB = 10
const VIEW_SLOTS = [
  ['front', 'Front', true], ['back', 'Back', false], ['left', 'Left', false], ['right', 'Right', false], ['top', 'Top', false], ['bottom', 'Bottom', false],
]
const MODE_HELP = {
  terrain: ['Upload a clear aerial, satellite, map, or drone image.', 'One image is the correct input for the terrain pipeline.'],
  object: ['Use a well-lit building or object photo with the subject clearly visible.', 'One photo creates a textured visible-surface mesh. Extra angles are recommended for future multi-view reconstruction.'],
  human: ['Use a full-body or upper-body photograph with the person separated from the background.', 'One photo creates only the visible surface. Front, left, and right images improve future multi-view reconstruction.'],
  anime: ['Use a clean, full-character anime, cartoon, or game-style image.', 'One image supports stylized visible-surface geometry; hidden hair, clothing, and back details cannot be measured from it.'],
}

function sameFile(a, b) { return a && b && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified }
function imageDimensions(url) { return new Promise(resolve => { const image = new window.Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => resolve({ width: 0, height: 0 }); image.src = url }) }
function hasSupportedExtension(file) { return /\.(jpe?g|png)$/i.test(file?.name || '') }
function describeUploadFailure(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'Upload timed out while waiting for the backend. Confirm FastAPI is running on http://127.0.0.1:8000 and retry.'
  if (error instanceof TypeError && /fetch|network|load/i.test(error.message || '')) return 'Cannot connect to the upload backend at http://127.0.0.1:8000. Start the FastAPI server, then retry.'
  return error?.message || 'Upload failed for an unknown reason.'
}

export default function UploadPanel({ mode = 'terrain', onUploaded, uploadedFile, inputAnalysis, onInputAnalysis, inputViews = {}, onInputViewsChange }) {
  const primaryInputRef = useRef(null)
  const extraInputRefs = useRef({})
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [viewLoading, setViewLoading] = useState('')
  const [error, setError] = useState(null)
  const [pendingPreview, setPendingPreview] = useState(null)
  const isMultiView = mode !== 'terrain' && mode !== 'text'
  const help = MODE_HELP[mode] || MODE_HELP.object

  function validate(file) {
    if (!file) return 'Choose an image first.'
    // Some browsers omit File.type for valid local images. Extension checks
    // keep the picker permissive while Pillow verifies the real bytes server-side.
    if (!hasSupportedExtension(file) || (file.type && !ALLOWED.includes(file.type))) return 'Only JPG and PNG files are supported.'
    if (file.size > MAX_MB * 1024 * 1024) return `File is too large. Maximum allowed size is ${MAX_MB} MB.`
    return null
  }
  async function upload(file) {
    const message = validate(file); if (message) throw new Error(message)
    const form = new FormData(); form.append('file', file)
    const response = await fetch('/api/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(30000) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}): ${data.detail || data.error || response.statusText || 'The backend did not provide details.'}`)
    const localUrl = URL.createObjectURL(file); const dims = await imageDimensions(localUrl)
    return { filename: data.filename, size: data.size_bytes ?? data.size, width: data.width || dims.width, height: data.height || dims.height, localUrl, remoteUrl: data.url || data.original_image_url || `/uploads/${data.stored_filename}`, fileId: data.file_id, sourceFile: file }
  }
  async function selectPrimary(file) {
    if (!file) return
    const message = validate(file)
    if (message) { setError(message); return }
    const previewUrl = URL.createObjectURL(file)
    const previewDimensions = await imageDimensions(previewUrl)
    setPendingPreview({ filename: file.name, size: file.size, localUrl: previewUrl, ...previewDimensions })
    setError(null); setLoading(true)
    try {
      const result = await upload(file); onUploaded(result.fileId, result); setPendingPreview(null)
      const analysisResponse = await fetch(`/api/process/${result.fileId}/input-analysis`)
      if (analysisResponse.ok) onInputAnalysis?.(await analysisResponse.json())
    } catch (err) { setError(describeUploadFailure(err)) } finally { setLoading(false) }
  }
  async function selectView(slot, file) {
    if (!file) return
    if (sameFile(file, uploadedFile?.sourceFile) || Object.values(inputViews).some(view => sameFile(file, view?.sourceFile))) { setError('That looks like an existing view. Choose a different camera angle.'); return }
    setError(null); setViewLoading(slot)
    try { const result = await upload(file); onInputViewsChange({ ...inputViews, [slot]: result }) } catch (err) { setError(`Could not upload the ${slot} view: ${describeUploadFailure(err)}`) } finally { setViewLoading('') }
  }
  function removeView(slot) { const next = { ...inputViews }; delete next[slot]; onInputViewsChange(next) }
  function onDrop(event) { event.preventDefault(); setDragOver(false); selectPrimary(event.dataTransfer?.files?.[0]) }
  const additionalCount = Math.max(0, Object.keys(inputViews).filter(key => key !== 'front').length)
  const readiness = isMultiView ? Math.min(100, 55 + additionalCount * 15) : 100

  return <div className="upload-workspace">
    <section className="card-panel input-guidance"><div><p className="eyebrow">{mode === 'terrain' ? 'TERRAIN INPUT' : 'VISIBLE-SURFACE RECONSTRUCTION'}</p><h3>{help[0]}</h3><p>{help[1]}</p></div>{isMultiView && <div className="single-view-warning"><View size={19} /><span>Current local model uses the front image for its mesh. Additional angles are retained as project inputs but are not falsely claimed as fused geometry.</span></div>}</section>
    <div className={`drop-zone ${dragOver ? 'drag-over' : ''}`} onDragOver={event => { event.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} onClick={() => !loading && primaryInputRef.current?.click()}>
      <input ref={primaryInputRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; selectPrimary(file) }} />
      {loading ? <div className="spinner-wrap" style={{ padding: 0 }}><div className="spinner" /><span>Validating and uploading…</span></div> : <><UploadCloud size={52} className="dz-icon" /><h3>{uploadedFile ? 'Replace primary image' : 'Drag and drop the primary image'}</h3><p>JPG / PNG · max {MAX_MB} MB · original image is preserved</p><button className="btn btn-primary" style={{ pointerEvents: 'none' }}>Select Image</button></>}
    </div>
    {error && <div className="state-box error"><AlertCircle size={32} /><h3>Input error</h3><p>{error}</p></div>}
    {pendingPreview && !uploadedFile && <section className="card-panel"><div className="card-title"><h3><Image size={18} /> Local preview ready</h3><span className="title-badge">WAITING FOR UPLOAD</span></div><div className="img-compare"><div className="img-panel"><label>Selected image</label><img src={pendingPreview.localUrl} alt="Selected image preview" /></div><div className="meta-list"><div className="meta-row"><span className="meta-label">File</span><span className="meta-value highlight">{pendingPreview.filename}</span></div><div className="meta-row"><span className="meta-label">Dimensions</span><span className="meta-value">{pendingPreview.width} × {pendingPreview.height}px</span></div><div className="meta-row"><span className="meta-label">File size</span><span className="meta-value">{(pendingPreview.size / 1024 / 1024).toFixed(2)} MB</span></div><p className="details-copy">This preview is local. Start the backend and select the image again to complete upload.</p></div></div></section>}
    {uploadedFile && <section className="card-panel"><div className="card-title"><h3><CheckCircle size={18} style={{ color: 'var(--primary-color)' }} /> Primary image ready</h3><span className="title-badge">PRESERVED</span></div><div className="img-compare"><div className="img-panel"><label><Image size={12} style={{ display: 'inline', marginRight: 6 }} />Front / primary image</label><img src={uploadedFile.localUrl} alt="Primary upload" /></div><div className="meta-list"><div className="meta-row"><span className="meta-label">File</span><span className="meta-value highlight">{uploadedFile.filename}</span></div><div className="meta-row"><span className="meta-label">Dimensions</span><span className="meta-value">{uploadedFile.width} × {uploadedFile.height}px</span></div><div className="meta-row"><span className="meta-label">File size</span><span className="meta-value">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</span></div>{inputAnalysis && <><div className="meta-row"><span className="meta-label">Input quality</span><span className="meta-value highlight">{Math.round(inputAnalysis.input_quality * 100)}% · {inputAnalysis.input_quality_label}</span></div><div className="analysis-note"><strong>Workflow guidance</strong><span>{inputAnalysis.workflow_recommendation}</span><small>{inputAnalysis.scene_classification_note}</small></div></>}<p className="details-copy">Continue to Depth Analysis when ready. Uploading alone never adds an item to saved history.</p></div></div></section>}
    {isMultiView && <section className="card-panel multiview-panel"><div className="card-title"><h3>Optional multi-view inputs</h3><span className="title-badge">READINESS {readiness}%</span></div><p className="details-copy">The local Depth Anything pipeline supports one visible image. Provide other angles now for a future multi-view/NeRF/Gaussian-splatting adapter; do not expect them to change the current single-image mesh.</p><div className="view-guide" aria-label="Recommended camera angles">{VIEW_SLOTS.map(([slot, label, required]) => <div className={inputViews[slot] ? 'ready' : ''} key={slot}><i>{slot.slice(0, 1).toUpperCase()}</i><span>{label}{required ? ' (primary)' : ' (optional)'}</span></div>)}</div><div className="view-grid">{VIEW_SLOTS.filter(([slot]) => slot !== 'front').map(([slot, label]) => <div className="view-card" key={slot}>{inputViews[slot] ? <><img src={inputViews[slot].localUrl} alt={`${label} view`} /><strong>{label} ✓</strong><button className="icon-button" onClick={() => removeView(slot)} aria-label={`Remove ${label} view`}><Trash2 size={15} /></button></> : <><input ref={element => { extraInputRefs.current[slot] = element }} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; selectView(slot, file) }} /><button className="view-add" onClick={() => extraInputRefs.current[slot]?.click()} disabled={Boolean(viewLoading)}>{viewLoading === slot ? <div className="spinner tiny" /> : <Plus size={18} />}<span>Add {label}</span></button></>}</div>)}</div></section>}
  </div>
}
