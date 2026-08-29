import { useState } from 'react'
import { AlertCircle, Crosshair, Search } from 'lucide-react'

const asCoordinate = (value, maximum) => Math.max(0, Math.min(Math.max(maximum - 1, 0), Math.round(Number(value) || 0)))

export default function QueryPanel({ fileId, uploadedFile, initialPoint }) {
  const [x, setX] = useState(() => initialPoint?.x ?? 0)
  const [y, setY] = useState(() => initialPoint?.y ?? 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  if (!fileId || !uploadedFile) return <div className="state-box"><Search size={48} className="state-icon" /><h3>No image loaded</h3><p>Upload an image and generate its depth map before running a point query.</p></div>

  async function query(event) {
    event.preventDefault(); setLoading(true); setError(null); setResult(null)
    const safeX = asCoordinate(x, uploadedFile.width)
    const safeY = asCoordinate(y, uploadedFile.height)
    setX(safeX); setY(safeY)
    try {
      const response = await fetch(`/api/process/${fileId}/analytics?x=${safeX}&y=${safeY}&reconstruction_type=terrain`, { signal: AbortSignal.timeout(15000) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Point query failed.')
      setResult(data)
    } catch (requestError) { setError(requestError.name === 'TimeoutError' ? 'Point query timed out. Please retry.' : (requestError.message || 'Point query failed.')) } finally { setLoading(false) }
  }

  return <div className="photo-details">
    <section className="card-panel"><div className="card-title"><h3><Crosshair size={18} /> Point query</h3></div><p className="details-copy">Query is independent from terrain and the 3D viewer. It reads the active image’s depth/elevation data only when you explicitly run a query.</p><form className="terrain-controls" onSubmit={query}><label>X coordinate<input type="number" min="0" max={Math.max(uploadedFile.width - 1, 0)} value={x} onChange={event => setX(event.target.value)} /></label><label>Y coordinate<input type="number" min="0" max={Math.max(uploadedFile.height - 1, 0)} value={y} onChange={event => setY(event.target.value)} /></label><button className="btn btn-primary" disabled={loading}>{loading ? 'Querying…' : <><Search size={16} /> Run query</>}</button></form><p className="pipeline-stage">Image bounds: 0–{uploadedFile.width - 1} × 0–{uploadedFile.height - 1}. Generate a depth map first.</p></section>
    {error && <div className="state-box error"><AlertCircle size={32} /><h3>Query error</h3><p>{error}</p></div>}
    {result && <section className="card-panel"><div className="card-title"><h3>Point result</h3><span className="title-badge">{result.is_calibrated ? 'CALIBRATED' : 'RELATIVE'}</span></div><p className="details-copy">{result.message}</p><div className="meta-list"><div className="meta-row"><span className="meta-label">Coordinate</span><span className="meta-value highlight">{result.x}, {result.y}</span></div><div className="meta-row"><span className="meta-label">Elevation</span><span className="meta-value">{result.elevation.toFixed(2)} m</span></div><div className="meta-row"><span className="meta-label">Slope</span><span className="meta-value">{result.slope.toFixed(2)}°</span></div><div className="meta-row"><span className="meta-label">Depth confidence</span><span className="meta-value">{Math.round(result.confidence * 100)}%</span></div></div></section>}
  </div>
}
