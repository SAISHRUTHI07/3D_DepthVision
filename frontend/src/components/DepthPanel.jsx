import { useState } from 'react'
import { Layers, AlertCircle, Clock, Sparkles } from 'lucide-react'

export default function DepthPanel({ fileId, uploadedFile, depthResult, mode = 'terrain', inputViewCount = 1, onDepthDone }) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [stage, setStage] = useState('Ready for image analysis.')

  async function runDepth() {
    if (!fileId) return
    setError(null); setLoading(true); setStage('Loading the local depth model and analysing the original image…')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 120000)
    try {
      const res = await fetch(`/api/process/${fileId}/depth`, { method: 'POST', signal: controller.signal })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || 'Depth estimation failed.')
      }
      const data = await res.json()
      onDepthDone(data); setStage('Depth map generated. The original image was not modified.')
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Depth estimation exceeded two minutes. The local model may be loading or the image may be too large; retry after checking the backend message.' : (e.message || 'An unexpected error occurred.'))
      setStage('Depth estimation did not finish. Review the error and retry.')
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  if (!fileId || !uploadedFile) {
    return (
      <div className="state-box">
        <Layers size={48} className="state-icon" />
        <h3>No Image Loaded</h3>
        <p>Please upload an image first using the Upload Image panel.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Action card */}
      <div className="card-panel">
        <div className="card-title">
          <h3><Layers size={18} /> Monocular Depth Estimation</h3>
          {depthResult && <span className="title-badge">COMPLETE</span>}
        </div>

        <div className="meta-list">
          <div className="meta-row">
            <span className="meta-label">Model</span>
            <span className="meta-value highlight">LiheYoung/depth-anything-small-hf</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Input Image</span>
            <span className="meta-value">{uploadedFile.filename}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Reconstruction mode</span>
            <span className="meta-value">{mode === 'scene' ? '3D Image / Scene' : mode === 'character' ? '3D Character' : `3D ${mode[0].toUpperCase()}${mode.slice(1)}`}</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Input views</span>
            <span className="meta-value">{inputViewCount} (the current local model uses the selected single image)</span>
          </div>
          <div className="meta-row">
            <span className="meta-label">Status</span>
            <span className="meta-value">
              {depthResult ? '✓ Depth map generated' : 'Ready to process'}
            </span>
          </div>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: 'fit-content' }}
          onClick={runDepth}
          disabled={loading}
        >
          {loading ? (
            <><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Processing…</>
          ) : (
            <><Layers size={16} /> {depthResult ? 'Re-generate Depth Map' : 'Generate Depth Map'}</>
          )}
        </button>

        <p className="pipeline-stage"><Sparkles size={14} /> {stage}</p>
      </div>

      {error && (
        <div className="state-box error">
          <AlertCircle size={32} style={{ color: '#ff4757' }} />
          <h3>Processing Error</h3>
          <p>{error}</p>
        </div>
      )}

      {depthResult && (
        <>
          {/* Side-by-side comparison */}
          <div className="img-compare">
            <div className="img-panel">
              <label>Original Image</label>
              <img src={uploadedFile.localUrl} alt="Original" />
            </div>
            <div className="img-panel">
              <label>Depth Map (Viridis)</label>
              <img src={depthResult.visual_depth_url} alt="Depth map" />
            </div>
          </div>

          {/* Metadata */}
          <div className="card-panel">
            <div className="card-title">
              <h3>Processing Results</h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
              <div className="meta-list">
                <div className="meta-row">
                  <span className="meta-label"><Clock size={12} style={{display:'inline',marginRight:4}} />Processing Time</span>
                  <span className="meta-value highlight">{depthResult.processing_time_sec}s</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label"><Sparkles size={12} style={{display:'inline',marginRight:4}} />Model</span>
                  <span className="meta-value" style={{ fontSize: 12 }}>{depthResult.model_name?.split('/').pop()}</span>
                </div>
              </div>
              <div className="meta-list">
                <div className="meta-row">
                  <span className="meta-label">Image Resolution</span>
                  <span className="meta-value">{depthResult.width} × {depthResult.height}px</span>
                </div>
                <div className="meta-row">
                  <span className="meta-label">Depth Range</span>
                  <span className="meta-value">{depthResult.min_val?.toFixed(2)} → {depthResult.max_val?.toFixed(2)}</span>
                </div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              ⚠ These are <em>relative depth</em> values. Switch to <strong style={{ color: 'var(--primary-color)' }}>Calibration</strong> to map to physical elevation.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
