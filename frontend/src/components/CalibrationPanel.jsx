import { useState, useRef, useEffect } from 'react'
import { Settings, Trash2, AlertCircle, CheckCircle } from 'lucide-react'

export default function CalibrationPanel({ fileId, uploadedFile, depthResult, calibResult, onCalibDone }) {
  const [gcps,    setGcps]    = useState([])     // { x, y, elevation: string, normX, normY }
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const imgRef = useRef(null)
  const canvasRef = useRef(null)

  // Redraw GCP markers on canvas whenever gcps or image changes
  useEffect(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    canvas.width  = img.offsetWidth
    canvas.height = img.offsetHeight
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    gcps.forEach((pt, i) => {
      const cx = pt.normX * canvas.width
      const cy = pt.normY * canvas.height
      ctx.beginPath()
      ctx.arc(cx, cy, 9, 0, 2 * Math.PI)
      ctx.fillStyle = 'rgba(102,252,241,0.3)'
      ctx.fill()
      ctx.strokeStyle = '#66fcf1'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 11px Inter, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(i + 1, cx, cy)
    })
  }, [gcps])

  function onImageClick(e) {
    if (!imgRef.current) return
    const rect = imgRef.current.getBoundingClientRect()
    const normX = (e.clientX - rect.left) / rect.width
    const normY = (e.clientY - rect.top)  / rect.height
    const px    = Math.round(normX * (uploadedFile?.width  || rect.width))
    const py    = Math.round(normY * (uploadedFile?.height || rect.height))
    setGcps(prev => [...prev, { x: px, y: py, elevation: '', normX, normY }])
  }

  function removeGcp(i) {
    setGcps(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateElev(i, val) {
    setGcps(prev => prev.map((pt, idx) => idx === i ? { ...pt, elevation: val } : pt))
  }

  async function runCalibration() {
    if (!fileId || !depthResult) return
    setError(null); setLoading(true)
    try {
      const gcpPayload = gcps
        .filter(pt => pt.elevation !== '' && !isNaN(parseFloat(pt.elevation)))
        .map(pt => ({ x: pt.x, y: pt.y, elevation: parseFloat(pt.elevation) }))

      const res = await fetch(`/api/process/${fileId}/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gcp_points: gcpPayload }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || 'Calibration failed.')
      }
      const data = await res.json()
      onCalibDone(data)
    } catch (e) {
      setError(e.message || 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  if (!fileId || !uploadedFile) {
    return (
      <div className="state-box">
        <Settings size={48} className="state-icon" />
        <h3>No Image Loaded</h3>
        <p>Upload an image and generate a depth map first.</p>
      </div>
    )
  }
  if (!depthResult) {
    return (
      <div className="state-box">
        <Settings size={48} className="state-icon" />
        <h3>Depth Map Required</h3>
        <p>Generate a depth map in the Depth Analysis panel before calibrating.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="card-panel">
        <div className="card-title">
          <h3><Settings size={18} /> Ground Control Points (GCPs)</h3>
          <span className="title-badge">{gcps.length} POINT{gcps.length !== 1 ? 'S' : ''}</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Click on the image to add reference points, then enter known elevation (metres) for each.
          Leave all empty to use relative depth scaling (0 – 100 m range).
        </p>

        {/* Clickable image with canvas overlay */}
        <div style={{ overflowX: 'auto' }}>
          <div className="calib-canvas-wrap" onClick={onImageClick}>
            <img
              ref={imgRef}
              src={uploadedFile.localUrl}
              alt="Click to add GCP"
              style={{ maxWidth: '100%', maxHeight: 420 }}
            />
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* GCP Table */}
        {gcps.length > 0 && (
          <table className="gcp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Image X</th>
                <th>Image Y</th>
                <th>Known Elevation (m)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gcps.map((pt, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--primary-color)', fontWeight: 600 }}>{i + 1}</td>
                  <td>{pt.x}</td>
                  <td>{pt.y}</td>
                  <td>
                    <input
                      type="number"
                      placeholder="e.g. 150.0"
                      value={pt.elevation}
                      onChange={e => updateElev(i, e.target.value)}
                    />
                  </td>
                  <td>
                    <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeGcp(i)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-primary" onClick={runCalibration} disabled={loading}>
            {loading ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Calibrating…</> : <><CheckCircle size={16} /> Apply Calibration</>}
          </button>
          {gcps.length > 0 && (
            <button className="btn btn-secondary" onClick={() => setGcps([])}>
              <Trash2 size={16} /> Clear All Points
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="state-box error">
          <AlertCircle size={32} style={{ color: '#ff4757' }} />
          <h3>Calibration Error</h3>
          <p>{error}</p>
        </div>
      )}

      {calibResult && (
        <div className="card-panel">
          <div className="card-title">
            <h3><CheckCircle size={18} style={{ color: 'var(--primary-color)' }} /> Calibration Result</h3>
            <span className="title-badge">{calibResult.is_calibrated ? 'GCP CALIBRATED' : 'RELATIVE'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Method</span><span className="meta-value highlight">{calibResult.method?.split('(')[0]}</span></div>
              <div className="meta-row"><span className="meta-label">GCPs Used</span><span className="meta-value">{calibResult.num_points_used}</span></div>
            </div>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Scale Factor</span><span className="meta-value">{calibResult.scale?.toFixed(4)}</span></div>
              <div className="meta-row"><span className="meta-label">Offset</span><span className="meta-value">{calibResult.offset?.toFixed(4)} m</span></div>
            </div>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Min Elevation</span><span className="meta-value">{calibResult.elevation_min?.toFixed(2)} m</span></div>
              <div className="meta-row"><span className="meta-label">Max Elevation</span><span className="meta-value">{calibResult.elevation_max?.toFixed(2)} m</span></div>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            ✓ Switch to <strong style={{ color: 'var(--primary-color)' }}>3D Terrain</strong> to visualize the calibrated elevation mesh.
          </p>
        </div>
      )}
    </div>
  )
}
