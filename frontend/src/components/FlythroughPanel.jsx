import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Play, Pause, Square, RotateCcw, AlertCircle, X, Camera } from 'lucide-react'

const finite = value => Number.isFinite(value) ? value : 0

export default function FlythroughPanel({ fileId, depthResult, terrainData, onTerrainLoaded, onExit }) {
  const mountRef = useRef(null)
  const runtimeRef = useRef({ playing: false, progress: 0, frame: 0, speed: 1, clearance: 105, distance: 265, mode: 'orbit' })
  const sceneRef = useRef({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('Load the terrain to preview the flight path.')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [clearance, setClearance] = useState(105)
  const [distance, setDistance] = useState(265)
  const [cameraMode, setCameraMode] = useState('orbit')

  async function loadTerrain() {
    if (terrainData) return terrainData
    if (!fileId || !depthResult) return null
    setLoading(true); setError(null); setStatus('Preparing terrain for flythrough…')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 45000)
    try {
      const response = await fetch(`/api/process/${fileId}/terrain?grid_size=128`, { signal: controller.signal })
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || 'Terrain could not be loaded.') }
      const data = await response.json()
      const expected = data.grid_size ** 2
      if (!data.elevation_grid || data.elevation_grid.length !== expected || data.elevation_grid.some(value => !Number.isFinite(value))) throw new Error('Terrain data is incomplete or invalid.')
      onTerrainLoaded(data)
      setStatus('Terrain ready. Press Start Flythrough.')
      return data
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Terrain preparation took too long. Please retry.' : err.message)
      setStatus('Terrain loading failed.')
      return null
    } finally { window.clearTimeout(timeout); setLoading(false) }
  }

  useEffect(() => {
    if (!terrainData || !mountRef.current) return
    buildScene(terrainData)
    setStatus('Terrain ready. Press Start Flythrough.')
    return disposeScene
  }, [terrainData])

  function buildScene(data) {
    disposeScene()
    const host = mountRef.current
    if (!host) return
    const width = host.clientWidth || 900; const height = host.clientHeight || 520
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x071018, 1); renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true; host.replaceChildren(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, width / height, .1, 2000)
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
    scene.add(new THREE.HemisphereLight(0xbbefff, 0x13231d, 1.6))
    const sun = new THREE.DirectionalLight(0xfff2d6, 2.4); sun.position.set(130, 220, 120); sun.castShadow = true; scene.add(sun)
    const n = data.grid_size; const elevation = data.elevation_grid; const min = finite(data.stats?.elevation_min); const range = Math.max(finite(data.stats?.elevation_max) - min, .00001)
    const geometry = new THREE.PlaneGeometry(220, 220, n - 1, n - 1); geometry.rotateX(-Math.PI / 2)
    const position = geometry.attributes.position; const colours = new Float32Array(position.count * 3)
    for (let i = 0; i < position.count; i++) {
      const normalized = THREE.MathUtils.clamp((finite(elevation[i]) - min) / range, 0, 1)
      position.setY(i, normalized * 92)
      colours[i * 3] = .09 + normalized * .45; colours[i * 3 + 1] = .24 + normalized * .48; colours[i * 3 + 2] = .32 + normalized * .42
    }
    position.needsUpdate = true; geometry.computeVertexNormals(); geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    const material = new THREE.MeshStandardMaterial({ vertexColors: !depthResult?.original_image_url, roughness: .82, metalness: .02 })
    if (depthResult?.original_image_url) new THREE.TextureLoader().load(depthResult.original_image_url, texture => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); material.map = texture; material.needsUpdate = true })
    const terrain = new THREE.Mesh(geometry, material); terrain.receiveShadow = true; terrain.castShadow = true; scene.add(terrain)
    scene.add(new THREE.Mesh(geometry.clone(), new THREE.MeshBasicMaterial({ color: 0x86fff7, wireframe: true, transparent: true, opacity: .10 })))
    const grid = new THREE.GridHelper(240, 24, 0x295462, 0x16343d); grid.position.y = -2; scene.add(grid)
    const target = new THREE.Vector3(0, 38, 0)
    const setOverview = () => { camera.position.set(255, 200, 255); camera.lookAt(target); controls.target.copy(target); controls.update() }
    setOverview()
    let previous = performance.now()
    const tick = now => {
      runtimeRef.current.frame = requestAnimationFrame(tick)
      const runtime = runtimeRef.current
      if (runtime.playing && runtime.mode === 'orbit') {
        const elapsed = Math.min((now - previous) / 1000, .05)
        runtime.progress = (runtime.progress + elapsed * runtime.speed * .035) % 1
        const a = runtime.progress * Math.PI * 2
        // An elevated orbital path deliberately frames the full 3D terrain.
        const orbit = new THREE.Vector3(Math.cos(a) * runtime.distance, 155 + Math.sin(a * 2) * 35 + runtime.clearance, Math.sin(a) * runtime.distance)
        camera.position.copy(orbit)
        camera.lookAt(target)
      } else controls.update()
      previous = now; renderer.render(scene, camera)
    }
    tick(performance.now())
    const resize = () => { const w = host.clientWidth || 900; const h = host.clientHeight || 520; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h) }
    window.addEventListener('resize', resize)
    sceneRef.current = { renderer, scene, camera, controls, geometry, material, resize, setOverview }
  }

  function disposeScene() {
    const { renderer, geometry, material, resize } = sceneRef.current
    if (runtimeRef.current.frame) cancelAnimationFrame(runtimeRef.current.frame)
    if (resize) window.removeEventListener('resize', resize)
    geometry?.dispose(); material?.map?.dispose(); material?.dispose(); renderer?.dispose()
    mountRef.current?.replaceChildren(); sceneRef.current = {}
  }

  async function start() {
    const data = await loadTerrain()
    if (!data) return
    // React mounts the canvas after terrain state changes. Wait one paint if required.
    requestAnimationFrame(() => {
      runtimeRef.current.playing = cameraMode === 'orbit'; runtimeRef.current.mode = cameraMode; setPlaying(cameraMode === 'orbit')
      setStatus(cameraMode === 'orbit' ? 'Flying around the generated 3D terrain on a clearance-safe orbital path.' : 'Free camera mode is active — orbit, pan, and zoom the terrain manually.')
    })
  }
  function pause() { runtimeRef.current.playing = false; setPlaying(false); setStatus('Flythrough paused — you can orbit the terrain.') }
  function stop() { runtimeRef.current.playing = false; runtimeRef.current.progress = 0; setPlaying(false); sceneRef.current.setOverview?.(); setStatus('Flight reset. The terrain remains available to inspect.') }

  if (!fileId || !depthResult) return <div className="state-box"><Play size={48} className="state-icon" /><h3>Depth map required</h3><p>Upload an image and generate a depth map before starting a flythrough.</p></div>
  return <div className="flythrough-page">
    <section className="card-panel"><div className="card-title"><h3><Camera size={18} /> Terrain Flythrough</h3>{playing && <span className="title-badge">FLYING</span>}</div><p className="fly-status">{status}</p><div className="flythrough-controls"><button className="btn btn-primary" onClick={start} disabled={loading || playing}>{loading ? 'Loading terrain…' : <><Play size={16} /> {cameraMode === 'orbit' ? 'Start Flythrough' : 'Enable Free Camera'}</>}</button><button className="btn btn-secondary" onClick={pause} disabled={!playing}><Pause size={16} /> Pause</button><button className="btn btn-secondary" onClick={stop}><Square size={16} /> Stop & Reset</button><button className="btn btn-secondary" onClick={() => sceneRef.current.setOverview?.()}><RotateCcw size={16} /> Reset Camera</button><button className="btn btn-secondary" onClick={onExit}><X size={16} /> Exit Viewer</button></div><div className="terrain-controls"><label>Camera mode:<select value={cameraMode} onChange={event => { const value = event.target.value; setCameraMode(value); runtimeRef.current.mode = value }}><option value="orbit">Orbit flythrough</option><option value="free">Free camera</option></select></label><label>Flight Speed: {speed.toFixed(1)}×<input type="range" min=".5" max="3" step=".25" value={speed} onChange={event => { const value = Number(event.target.value); setSpeed(value); runtimeRef.current.speed = value }} /></label><label>View Height: {clearance}m<input type="range" min="40" max="170" step="5" value={clearance} onChange={event => { const value = Number(event.target.value); setClearance(value); runtimeRef.current.clearance = value }} /></label><label>Camera Distance: {distance}m<input type="range" min="160" max="420" step="5" value={distance} onChange={event => { const value = Number(event.target.value); setDistance(value); runtimeRef.current.distance = value }} /></label></div></section>
    {error && <div className="state-box error"><AlertCircle size={32} /><h3>Flythrough unavailable</h3><p>{error}</p><button className="btn btn-secondary" onClick={start}>Retry</button></div>}
    <div className="terrain-canvas-wrap flythrough-canvas" ref={mountRef} />
    <p className="fly-hint">This camera follows a high, stable orbit around the actual terrain mesh. Pause any time to rotate, zoom, and pan manually.</p>
  </div>
}
