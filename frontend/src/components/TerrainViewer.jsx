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
  const [vizMode,  setVizMode]  = useState('textured') // textured | elevation | wireframe | depth
  const [displayMode, setDisplayMode] = useState('3d')
  const [showTexture, setShowTexture] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [stage, setStage] = useState('Ready to build terrain')
  const [selectedPoint, setSelectedPoint] = useState(null)

  // ── Load terrain from backend ──────────────────────────────────────────────
  async function loadTerrain(size = gridSize) {
    if (!fileId || !depthResult) return
    setError(null); setLoading(true); setStage('Preparing elevation grid')
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 45000)
    try {
      const res = await fetch(`/api/process/${fileId}/terrain?grid_size=${size}&reconstruction_type=terrain`, { signal: controller.signal })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.detail || 'Terrain generation failed.')
      }
      const data = await res.json()
      const expected = data.grid_size * data.grid_size
      if (!data.elevation_grid || data.elevation_grid.length !== expected || !data.depth_grid || data.depth_grid.length !== expected || !data.slope_grid || !data.confidence_grid) throw new Error('Terrain response is incomplete. Please retry with a lower grid size.')
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
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 3000)

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance   = 25
    controls.maxDistance   = 900
    controls.maxPolarAngle = Math.PI * .495
    controls.enablePan = true
    controls.autoRotate = autoRotate
    controls.autoRotateSpeed = .55

    // Lights
    const ambient = new THREE.HemisphereLight(0xd9edff, 0x26351f, 1.55)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xfff5df, 2.8)
    dir.position.set(140, 220, 110)
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -180; dir.shadow.camera.right = 180
    dir.shadow.camera.top = 180; dir.shadow.camera.bottom = -180
    scene.add(dir)

    // Grid helper
    const grid = new THREE.GridHelper(200, 20, 0x222f3d, 0x1a2535)
    grid.position.y = -0.5
    scene.add(grid)

    // ── Terrain mesh ──
    const N    = terrainData.grid_size
    const elev = terrainData.elevation_grid
    const slope = terrainData.slope_grid
    const depth = terrainData.depth_grid
    const stats = terrainData.stats

    const eMin = Number.isFinite(stats.visual_min) ? stats.visual_min : stats.elevation_min
    const eMax = Number.isFinite(stats.visual_max) ? stats.visual_max : stats.elevation_max
    const eRange = Math.max(eMax - eMin, 1e-5)

    // Keep the image aspect ratio. A square mesh stretches wide aerial images
    // even when their depth grid is otherwise correct.
    const sourceWidth = Math.max(1, terrainData.source_width || N)
    const sourceHeight = Math.max(1, terrainData.source_height || N)
    const aspect = sourceWidth / sourceHeight
    const planeWidth = 200
    const planeDepth = planeWidth / aspect
    const geo  = new THREE.PlaneGeometry(planeWidth, planeDepth, N - 1, N - 1)
    geo.rotateX(-Math.PI / 2)
    const pos  = geo.attributes.position

    // Choose color source
    const colors = []
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((elev[i] - eMin) / eRange, 0, 1)
      // A bounded relief range avoids both flat meshes and exaggerated spikes.
      const vy = t * 34 * exag
      pos.setY(i, vy)

      const col = vizMode === 'depth' ? new THREE.Color().setScalar(THREE.MathUtils.clamp(depth[i] ?? 0, 0, 1)) : elevToColor(t)
      colors.push(col.r, col.g, col.b)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: vizMode !== 'textured',
      roughness: 0.9,
      metalness: 0.0,
      wireframe: vizMode === 'wireframe',
      side: THREE.FrontSide,
    })
    if (vizMode === 'wireframe') { mat.color.set(0x75f4e6); mat.wireframeLinewidth = 1 }
    // Drape the real uploaded image over the elevation mesh. The vertices still
    // come exclusively from elevation_grid; the texture makes that relief legible.
    if (vizMode === 'textured' && depthResult?.original_image_url) {
      new THREE.TextureLoader().load(depthResult.original_image_url, texture => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texture.minFilter = THREE.LinearMipmapLinearFilter
        mat.map = texture
        mat.needsUpdate = true
      }, undefined, () => setError('Terrain geometry loaded, but the original image texture could not be loaded.'))
    }

    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    mesh.castShadow = true
    scene.add(mesh)

    const target = new THREE.Vector3(0, 16 * exag, 0)
    const span = Math.max(planeWidth, planeDepth)
    const defaultPosition = new THREE.Vector3(span * .72, span * .58 + 45 * exag, span * .78)
    camera.position.copy(defaultPosition); controls.target.copy(target); controls.update()

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
        // Use texture UVs to return original image pixels exactly. This avoids
        // grid-resolution error and the old vertical flip from world Z.
        const uv = hits[0].uv
        const px = Math.round(THREE.MathUtils.clamp(uv.x, 0, 1) * (sourceWidth - 1))
        const py = Math.round((1 - THREE.MathUtils.clamp(uv.y, 0, 1)) * (sourceHeight - 1))
        const gx = Math.round(THREE.MathUtils.clamp(uv.x, 0, 1) * (N - 1))
        const gy = Math.round((1 - THREE.MathUtils.clamp(uv.y, 0, 1)) * (N - 1))
        const index = gy * N + gx
        setSelectedPoint({ x: px, y: py, elevation: elev[index], relativeHeight: THREE.MathUtils.clamp((elev[index] - eMin) / eRange, 0, 1) * 100, slope: slope[index] || 0 })
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

    sceneRef.current = { renderer, scene, camera, controls, mesh, animId, onResize, onClick, defaultPosition, target }
  }

  function destroyScene() {
    const { renderer, scene, animId, onResize, onClick } = sceneRef.current
    if (animId) cancelAnimationFrame(animId)
    if (onResize) window.removeEventListener('resize', onResize)
    if (renderer) {
      renderer.domElement.removeEventListener('click', onClick)
      scene?.traverse(object => {
        if (!object.isMesh) return
        object.geometry?.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => { material?.map?.dispose(); material?.dispose() })
      })
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
    const { camera, controls, defaultPosition, target } = sceneRef.current
    if (!camera) return
    camera.position.copy(defaultPosition)
    controls?.target.copy(target)
    controls?.update()
  }
  function fullscreen() { mountRef.current?.requestFullscreen?.() }

  // ── Color mapping helpers ──
  function elevToColor(t) {
    // Continuous cool → vegetation → warm highland → snow gradient.
    const stops = [[0, '#123c79'], [.22, '#2b91c9'], [.45, '#4f9f58'], [.62, '#c6c750'], [.78, '#ba7539'], [.92, '#815842'], [1, '#f4f2df']]
    const upper = stops.findIndex(([stop]) => t <= stop)
    const [aT, a] = stops[Math.max(0, upper - 1)]
    const [bT, b] = stops[Math.max(0, upper)]
    return new THREE.Color(a).lerp(new THREE.Color(b), (t - aT) / Math.max(bT - aT, .0001))
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
              {[128, 192, 256, 320].map(s => <option key={s} value={s}>{s}×{s}</option>)}
            </select>
          </label>

          <label>
            Vertical Scale: ×{exag}
            <input type="range" min={0.5} max={3.5} step={0.25} value={exag} onChange={e => setExag(Number(e.target.value))} />
          </label>

          <label>
            Terrain Mode:
            <select
              value={vizMode}
              onChange={e => setVizMode(e.target.value)}
              style={{ background: 'var(--bg-sidebar)', color: 'var(--text-heading)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', marginLeft: 6 }}
            >
              <option value="textured">Textured Terrain</option>
              <option value="elevation">Elevation / Height Map</option>
              <option value="wireframe">Wireframe</option>
              <option value="depth">Depth Map</option>
            </select>
          </label>

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
              {vizMode === 'depth' ? 'Normalized depth' : terrainData.is_calibrated ? 'Elevation (m)' : 'Relative height'}
            </div>
            <div className="legend-bar"
              style={vizMode === 'depth' ? { background: 'linear-gradient(90deg,#090909,#fff)' } : { background: 'linear-gradient(90deg,#123c79,#2b91c9,#4f9f58,#c6c750,#ba7539,#f4f2df)' }}
            />
            <div className="legend-labels">
              <span>{vizMode === 'depth' ? 'Far' : terrainData.stats.visual_min?.toFixed(0) + (terrainData.is_calibrated ? 'm' : '')}</span>
              <span>{vizMode === 'depth' ? 'Near' : terrainData.stats.visual_max?.toFixed(0) + (terrainData.is_calibrated ? 'm' : '')}</span>
            </div>
          </div>
          {selectedPoint && <div className="terrain-point-readout"><strong>Terrain sample</strong><span>X/Y: {selectedPoint.x}, {selectedPoint.y}</span><span>Height: {selectedPoint.elevation?.toFixed(2)}{terrainData.is_calibrated ? ' m' : ''}</span><span>Relative: {selectedPoint.relativeHeight?.toFixed(1)}%</span><span>Slope: {selectedPoint.slope?.toFixed(1)}°</span></div>}
          {terrainData.stats?.is_flat && <p className="terrain-note">This image produced a low-variation depth map; the terrain is intentionally kept nearly flat.</p>}
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
              <div className="meta-row"><span className="meta-label">Min Height</span><span className="meta-value highlight">{terrainData.stats.elevation_min?.toFixed(2)}{terrainData.is_calibrated ? ' m' : ''}</span></div>
              <div className="meta-row"><span className="meta-label">Max Height</span><span className="meta-value highlight">{terrainData.stats.elevation_max?.toFixed(2)}{terrainData.is_calibrated ? ' m' : ''}</span></div>
            </div>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Min Slope</span><span className="meta-value">{terrainData.stats.slope_min?.toFixed(2)}°</span></div>
              <div className="meta-row"><span className="meta-label">Max Slope</span><span className="meta-value">{terrainData.stats.slope_max?.toFixed(2)}°</span></div>
            </div>
            <div className="meta-list">
              <div className="meta-row"><span className="meta-label">Height reference</span><span className="meta-value">{terrainData.is_calibrated ? '✓ GCP calibrated' : '⚠ Relative depth'}</span></div>
              <div className="meta-row"><span className="meta-label">Resolution</span><span className="meta-value">{terrainData.grid_size}×{terrainData.grid_size}</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
