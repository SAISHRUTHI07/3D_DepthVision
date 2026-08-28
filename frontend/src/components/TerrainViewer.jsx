import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Box, AlertCircle, RotateCcw, Expand, BookmarkPlus } from 'lucide-react'

export default function TerrainViewer({ fileId, depthResult, terrainData, onTerrainLoaded, onPointClick, onSave, canSave }) {
  const mountRef   = useRef(null)
  const sceneRef   = useRef({})       // { renderer, scene, camera, controls, mesh, animId }
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [gridSize, setGridSize] = useState(128)
  const [exag,     setExag]     = useState(1.5)
  const [vizMode,  setVizMode]  = useState('elevation') // elevation | slope | confidence | wireframe
  const [displayMode, setDisplayMode] = useState('3d')
  const [showTexture, setShowTexture] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [stage, setStage] = useState('Ready to build terrain')

  // ── Load terrain from backend ──────────────────────────────────────────────
  async function loadTerrain(size = gridSize) {
    if (!fileId || !depthResult) return
    setError(null); setLoading(true); setStage('Preparing elevation grid')
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 45000)
    try {
      const res = await fetch(`/api/process/${fileId}/terrain?grid_size=${size}`, { signal: controller.signal })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || 'Terrain generation failed.')
      }
      const data = await res.json()
      const expected = data.grid_size * data.grid_size
      if (!data.elevation_grid || data.elevation_grid.length !== expected || !data.slope_grid || !data.confidence_grid) throw new Error('Terrain response is incomplete. Please retry with a lower grid size.')
      if (data.elevation_grid.some(value => !Number.isFinite(value))) throw new Error('Terrain response contains invalid elevation values.')
      setStage('Building 3D terrain')
      onTerrainLoaded(data)
      setStage('Terrain ready')
    } catch (e) {
      setError(e.name === 'AbortError' ? 'Terrain generation is taking longer than expected. Retry at 128×128 resolution.' : e.message)
      setStage('Terrain could not be loaded')
    } finally {
      window.clearTimeout(timer)
      setLoading(false)
    }
  }

  function buildScene() {
    destroyScene()
    const el = mountRef.current
    if (!el) return

    const W = el.clientWidth  || 800
    const H = el.clientHeight || 520

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x0a0d12, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    el.appendChild(renderer.domElement)

    // Scene + Camera
    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 2000)
    camera.position.set(0, 80, 120)
    camera.lookAt(0, 0, 0)

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance   = 20
    controls.maxDistance   = 600
    controls.maxPolarAngle = Math.PI / 2
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = .55

    // Lights
    const ambient = new THREE.HemisphereLight(0xc8f1ff, 0x17271d, 1.5)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xfff2db, 2.2)
    dir.position.set(110, 160, 80)
    dir.castShadow = true
    scene.add(dir)

    // Grid helper
    const grid = new THREE.GridHelper(200, 20, 0x222f3d, 0x1a2535)
    grid.position.y = -0.5
    scene.add(grid)

    // ── Terrain mesh ──
    const N    = terrainData.grid_size
    const elev = terrainData.elevation_grid
    const slope = terrainData.slope_grid
    const conf  = terrainData.confidence_grid
    const stats = terrainData.stats

    const eMin = stats.elevation_min
    const eMax = stats.elevation_max
    const eRange = eMax - eMin || 1
    const sMax  = stats.slope_max || 1

    const geo  = new THREE.PlaneGeometry(200, 200, N - 1, N - 1)
    geo.rotateX(-Math.PI / 2)
    const pos  = geo.attributes.position

    // Choose color source
    const colors = []
    for (let i = 0; i < pos.count; i++) {
      const t = (elev[i] - eMin) / eRange   // 0..1
      const vy = (elev[i] - eMin) / eRange * 40 * exag
      pos.setY(i, vy)

      let col
      if (vizMode === 'slope') {
        const st = Math.min((slope[i] || 0) / (sMax || 1), 1)
        col = elevToColor(st, 'slope')
      } else if (vizMode === 'confidence') {
        const ct = conf[i] ?? 1
        col = elevToColor(ct, 'confidence')
      } else {
        col = elevToColor(t, 'elevation')
      }
      colors.push(col.r, col.g, col.b)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: !(vizMode === 'elevation' && showTexture && depthResult?.original_image_url),
      roughness: 0.78,
      metalness: 0.04,
      wireframe: vizMode === 'wireframe',
    })
    if (vizMode === 'wireframe') mat.color.set(0x66fcf1)
    // Drape the real uploaded image over the elevation mesh. The vertices still
    // come exclusively from elevation_grid; the texture makes that relief legible.
    if (vizMode === 'elevation' && showTexture && depthResult?.original_image_url) {
      new THREE.TextureLoader().load(depthResult.original_image_url, texture => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texture.minFilter = THREE.LinearMipmapLinearFilter
        mat.map = texture
        mat.needsUpdate = true
      })
    }

    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.castShadow = true
    scene.add(mesh)

    // Surface points expose the actual X/Y/Z samples in elevation_grid. This is
    // not a simulated model: every visible point corresponds to a backend grid cell.
    if (vizMode === 'elevation') {
      const pointGeo = new THREE.BufferGeometry()
      const pointPositions = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        pointPositions[i * 3] = pos.getX(i)
        pointPositions[i * 3 + 1] = pos.getY(i) + 0.22
        pointPositions[i * 3 + 2] = pos.getZ(i)
      }
      pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3))
      scene.add(new THREE.Points(pointGeo, new THREE.PointsMaterial({ color: 0x73fff4, size: 0.5, transparent: true, opacity: 0.34, sizeAttenuation: true })))
    }

    // Raycaster for click
    const raycaster = new THREE.Raycaster()
    const mouse     = new THREE.Vector2()
    function onClick(e) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObject(mesh)
      if (hits.length > 0) {
        const { x, z } = hits[0].point
        // Convert local coords back to pixel coords (approx)
        const px = Math.round(((x / 200) + 0.5) * (terrainData.grid_size - 1))
        const py = Math.round(((z / 200) + 0.5) * (terrainData.grid_size - 1))
        if (onPointClick) onPointClick(px, py)
      }
    }
    renderer.domElement.addEventListener('click', onClick)

    // Animate
    let animId
    function animate() {
      animId = requestAnimationFrame(animate)
      // Keep the newest frame id so scene teardown always stops the active loop.
      sceneRef.current.animId = animId
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize
    function onResize() {
      const W2 = el.clientWidth
      const H2 = el.clientHeight
      camera.aspect = W2 / H2
      camera.updateProjectionMatrix()
      renderer.setSize(W2, H2)
    }
    window.addEventListener('resize', onResize)

    sceneRef.current = { renderer, scene, camera, controls, mesh, animId, onResize, onClick }
  }

  function destroyScene() {
    const { renderer, animId, onResize, onClick } = sceneRef.current
    if (animId) cancelAnimationFrame(animId)
    if (onResize) window.removeEventListener('resize', onResize)
    if (renderer) {
      renderer.domElement.removeEventListener('click', onClick)
      renderer.dispose()
      mountRef.current?.removeChild(renderer.domElement)
    }
    sceneRef.current = {}
  }

  // ── Build / rebuild Three.js scene ─────────────────────────────────────────
  useEffect(() => {
    if (!terrainData || !mountRef.current) return undefined
    buildScene()
    return destroyScene
  }, [terrainData, exag, vizMode, displayMode, showTexture, autoRotate])

  function resetCamera() {
    const { camera, controls } = sceneRef.current
    if (!camera) return
    camera.position.set(0, 80, 120)
    camera.lookAt(0, 0, 0)
    controls?.reset()
  }
  function fullscreen() { mountRef.current?.requestFullscreen?.() }

  // ── Color mapping helpers ──
  function elevToColor(t, mode) {
    const c = new THREE.Color()
    if (mode === 'slope') {
      // Green (low) → Red (high)
      c.setRGB(t, 1 - t, 0)
    } else if (mode === 'confidence') {
      // Red (low conf) → Cyan (high conf)
      c.setRGB(1 - t, t, t)
    } else {
      // Elevation: navy → blue → cyan → green → yellow → orange → red
      if (t < 0.17)      c.setRGB(0.05, 0.05, 0.55 + t * 2.6)
      else if (t < 0.33) c.setRGB(0, 0.7 * ((t - 0.17) / 0.16), 1)
      else if (t < 0.5)  c.setRGB(0, 0.7 + 0.3 * ((t - 0.33) / 0.17), 0.5 - (t - 0.33) * 3)
      else if (t < 0.67) c.setRGB((t - 0.5) / 0.17, 1, 0)
      else if (t < 0.83) c.setRGB(1, 1 - (t - 0.67) / 0.16, 0)
      else               c.setRGB(1, 0, 0)
    }
    return c
  }

  // ── Guard states ──
  if (!fileId || !depthResult) {
    return (
      <div className="state-box">
        <Box size={48} className="state-icon" />
        <h3>No Data Ready</h3>
        <p>Upload an image and generate a depth map first.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Controls row */}
      <div className="card-panel">
        <div className="card-title">
          <h3><Box size={18} /> Terrain Controls</h3>
          {terrainData && <span className="title-badge">{terrainData.grid_size}×{terrainData.grid_size} GRID</span>}
        </div>
        <div className="terrain-controls">
          <label>
            Grid Size:
            <select
              value={gridSize}
              onChange={e => setGridSize(Number(e.target.value))}
              style={{ background: 'var(--bg-sidebar)', color: 'var(--text-heading)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', marginLeft: 6 }}
            >
              {[128, 192, 256].map(s => <option key={s} value={s}>{s}×{s}</option>)}
            </select>
          </label>

          <label>
            Elevation Scale: ×{exag}
            <input type="range" min={0.5} max={4} step={0.25} value={exag} onChange={e => setExag(Number(e.target.value))} />
          </label>

          <label>
            View:
            <select
              value={vizMode}
              onChange={e => setVizMode(e.target.value)}
              style={{ background: 'var(--bg-sidebar)', color: 'var(--text-heading)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', marginLeft: 6 }}
            >
              <option value="elevation">Elevation</option>
              <option value="slope">Slope</option>
              <option value="confidence">Confidence</option>
              <option value="wireframe">Wireframe</option>
            </select>
          </label>

          <label><input type="checkbox" checked={showTexture} onChange={e => setShowTexture(e.target.checked)} /> Original texture</label>
          <label><input type="checkbox" checked={autoRotate} onChange={e => setAutoRotate(e.target.checked)} /> Auto rotate</label>

          <button className="btn btn-primary" onClick={() => loadTerrain(gridSize)} disabled={loading}>
            {loading ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading…</> : 'Load Terrain'}
          </button>
          {terrainData && (
            <><button className="btn btn-secondary" onClick={resetCamera}><RotateCcw size={15} /> Reset Camera</button><button className="btn btn-secondary" onClick={fullscreen}><Expand size={15} /> Fullscreen</button>{canSave && <button className="btn btn-secondary" onClick={onSave}><BookmarkPlus size={15} /> Save to History</button>}</>
          )}
        </div>
      </div>

      {error && (
        <div className="state-box error">
          <AlertCircle size={32} style={{ color: '#ff4757' }} />
          <h3>Terrain Error</h3>
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={() => loadTerrain(128)}>Retry at 128×128</button>
        </div>
      )}

      {/* Three.js canvas */}
      {terrainData ? (
        <div style={{ position: 'relative' }}>
          <div className="view-switch"><button className={displayMode === 'original' ? 'active' : ''} onClick={() => setDisplayMode('original')}>Original</button><button className={displayMode === '3d' ? 'active' : ''} onClick={() => setDisplayMode('3d')}>3D View</button><button className={displayMode === 'split' ? 'active' : ''} onClick={() => setDisplayMode('split')}>Split View</button></div>
          <div className={displayMode === 'split' ? 'terrain-split' : ''}>
            {displayMode !== 'original' && <div className="terrain-canvas-wrap" ref={mountRef} />}
            {displayMode !== '3d' && <div className="original-preview"><span>Original image</span><img src={depthResult.original_image_url} alt="Original uploaded terrain" /></div>}
          </div>

          {/* Legend */}
          <div className="terrain-legend">
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              {vizMode === 'elevation' ? 'Elevation (m)' : vizMode === 'slope' ? 'Slope (°)' : 'Confidence'}
            </div>
            <div className="legend-bar"
              style={ vizMode === 'slope'
                ? { background: 'linear-gradient(90deg,#00ff00,#ff0000)' }
                : vizMode === 'confidence'
                  ? { background: 'linear-gradient(90deg,#ff0000,#00ffff)' }
                  : undefined }
            />
            <div className="legend-labels">
              <span>{vizMode === 'elevation' ? terrainData.stats.elevation_min?.toFixed(0) + 'm' : vizMode === 'slope' ? '0°' : 'Low'}</span>
              <span>{vizMode === 'elevation' ? terrainData.stats.elevation_max?.toFixed(0) + 'm' : vizMode === 'slope' ? terrainData.stats.slope_max?.toFixed(0) + '°' : 'High'}</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            💡 Open Analytics manually to query a point; terrain viewing never redirects away from this page.
          </p>
        </div>
      ) : (
        loading ? <div className="state-box"><div className="spinner" /><h3>Loading Terrain</h3><p>{stage}</p><small style={{ color: 'var(--text-muted)' }}>Preparing image → Elevation grid → 3D mesh → Texture</small></div> : (
          <div className="state-box">
            <Box size={48} className="state-icon" />
            <h3>No Terrain Data</h3>
            <p>Click "Load Terrain" to generate the 3D mesh from backend data.</p>
          </div>
        )
      )}

      {/* Stats */}
      {terrainData && (
        <div className="card-panel">
          <div className="card-title"><h3>Terrain Statistics</h3></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16 }}>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Min Elevation</span><span className="meta-value highlight">{terrainData.stats.elevation_min?.toFixed(2)} m</span></div>
              <div className="meta-row"><span className="meta-label">Max Elevation</span><span className="meta-value highlight">{terrainData.stats.elevation_max?.toFixed(2)} m</span></div>
            </div>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Min Slope</span><span className="meta-value">{terrainData.stats.slope_min?.toFixed(2)}°</span></div>
              <div className="meta-row"><span className="meta-label">Max Slope</span><span className="meta-value">{terrainData.stats.slope_max?.toFixed(2)}°</span></div>
            </div>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Calibrated</span><span className="meta-value">{terrainData.is_calibrated ? '✓ Yes' : '⚠ Relative'}</span></div>
              <div className="meta-row"><span className="meta-label">Resolution</span><span className="meta-value">{terrainData.grid_size}×{terrainData.grid_size}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
