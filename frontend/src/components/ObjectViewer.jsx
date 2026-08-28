import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AlertCircle, BookmarkPlus, Box, Download, Expand, RotateCcw, ScanSearch, Sparkles } from 'lucide-react'

const finite = value => Number.isFinite(value) ? value : 0
const TYPE_COPY = {
  object: { title: '3D Object Reconstruction', subject: 'building or primary object', single: 'A textured, closed visible-surface mesh is created from this photograph.' },
  human: { title: '3D Human Reconstruction', subject: 'person', single: 'The generated mesh preserves the visible pose, clothing, and colour where the depth estimate supports it.' },
  anime: { title: '3D Character Reconstruction', subject: 'stylized character', single: 'The mesh uses the visible character silhouette and texture; it does not impose a realistic human body.' },
}

function createVisibleSurfaceGeometry(data, image, depthScale, detail) {
  const n = data.grid_size
  const mask = data.object_mask.map(value => finite(value) > .45)
  const depth = data.depth_grid.map(finite)
  if (!mask.some(Boolean)) mask.fill(true)
  const activeDepth = depth.filter((_, index) => mask[index]).sort((a, b) => a - b)
  const median = activeDepth[Math.floor(activeDepth.length / 2)] || .5
  const aspect = THREE.MathUtils.clamp((image?.width || 1) / Math.max(image?.height || 1, 1), .45, 2.2)
  const height = 180
  const width = height * aspect
  const vertexByCell = new Int32Array(n * n).fill(-1)
  const positions = [], uvs = []
  let index = 0
  for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
    const cell = row * n + column
    if (!mask[cell]) continue
    const x = (column / Math.max(n - 1, 1) - .5) * width
    const y = (.5 - row / Math.max(n - 1, 1)) * height
    const z = THREE.MathUtils.clamp((depth[cell] - median) * depthScale * detail, -depthScale * detail, depthScale * detail)
    vertexByCell[cell] = index++
    positions.push(x, y, z); uvs.push(column / Math.max(n - 1, 1), 1 - row / Math.max(n - 1, 1))
  }
  const frontIndices = []
  for (let row = 0; row < n - 1; row++) for (let column = 0; column < n - 1; column++) {
    const a = vertexByCell[row * n + column], b = vertexByCell[row * n + column + 1], c = vertexByCell[(row + 1) * n + column], d = vertexByCell[(row + 1) * n + column + 1]
    if (a >= 0 && b >= 0 && c >= 0 && d >= 0) frontIndices.push(a, c, b, b, c, d)
  }
  // A very fragmented mask can have no complete cell at low resolution.  Using
  // the depth grid in that rare case prevents an invisible result while keeping
  // the status message explicit about the estimated rear shell.
  if (!frontIndices.length) return createVisibleSurfaceGeometry({ ...data, object_mask: data.object_mask.map(() => 1) }, image, depthScale, detail)
  const frontVertexCount = index
  const zValues = positions.filter((_, positionIndex) => positionIndex % 3 === 2)
  const rearZ = Math.min(...zValues) - Math.max(10, depthScale * detail * .34)
  for (let i = 0; i < frontVertexCount; i++) {
    positions.push(positions[i * 3], positions[i * 3 + 1], rearZ)
    uvs.push(uvs[i * 2], uvs[i * 2 + 1])
  }
  const shellIndices = []
  for (let cursor = 0; cursor < frontIndices.length; cursor += 3) shellIndices.push(frontIndices[cursor + 2] + frontVertexCount, frontIndices[cursor + 1] + frontVertexCount, frontIndices[cursor] + frontVertexCount)
  const neighbours = [[0, -1], [0, 1], [-1, 0], [1, 0]]
  for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
    const a = vertexByCell[row * n + column]; if (a < 0) continue
    for (const [dy, dx] of neighbours) {
      const nr = row + dy, nc = column + dx
      if (nr >= 0 && nr < n && nc >= 0 && nc < n && vertexByCell[nr * n + nc] >= 0) continue
      // Pair each exposed vertex with its next edge vertex so the estimated
      // rear surface is connected by actual side-wall triangles.
      const edgeRow = dx !== 0 ? Math.min(row + 1, n - 1) : row
      const edgeColumn = dy !== 0 ? Math.min(column + 1, n - 1) : column
      const b = vertexByCell[edgeRow * n + edgeColumn]
      if (b >= 0 && b !== a) shellIndices.push(a, b, b + frontVertexCount, a, b + frontVertexCount, a + frontVertexCount)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex([...frontIndices, ...shellIndices])
  geometry.clearGroups(); geometry.addGroup(0, frontIndices.length, 0); geometry.addGroup(frontIndices.length, shellIndices.length, 1)
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return { geometry, width, height, vertices: frontVertexCount, faces: (frontIndices.length + shellIndices.length) / 3 }
}

export default function ObjectViewer({ fileId, uploadedFile, depthResult, objectData, mode = 'object', inputViews = {}, onObjectLoaded, onSave, canSave, textModel }) {
  const mountRef = useRef(null)
  const sceneRef = useRef({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [depthScale, setDepthScale] = useState(82)
  const [detail, setDetail] = useState(1)
  const [showTexture, setShowTexture] = useState(true)
  const [showWireframe, setShowWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [viewerBackground, setViewerBackground] = useState('studio')
  const copy = TYPE_COPY[mode] || TYPE_COPY.object

  async function generateModel() {
    if (!fileId || !depthResult) return
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), 45000)
    setLoading(true); setError(null)
    try {
      const response = await fetch(`/api/process/${fileId}/object?grid_size=128`, { signal: controller.signal })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Object reconstruction failed.')
      const expected = data.grid_size ** 2
      if (!data.depth_grid || !data.object_mask || data.depth_grid.length !== expected || data.object_mask.length !== expected || data.depth_grid.some(value => !Number.isFinite(value))) throw new Error('The reconstruction response did not contain a valid finite depth grid.')
      onObjectLoaded({ ...data, model_type: 'Depth Anything + OpenCV silhouette + Three.js closed visible-surface mesh' })
    } catch (err) { setError(err.name === 'AbortError' ? 'Reconstruction took too long. Try a smaller image or retry.' : (err.message || 'Object reconstruction failed.')) } finally { window.clearTimeout(timeout); setLoading(false) }
  }
  function buildScene() {
    destroyScene()
    const element = mountRef.current; if (!element) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    const width = element.clientWidth || 800, height = element.clientHeight || 520
    renderer.setSize(width, height); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = true
    const backgrounds = { studio: 0x090b1d, navy: 0x071b35, violet: 0x160d32, pearl: 0x20212b }
    renderer.setClearColor(backgrounds[viewerBackground], 1); element.replaceChildren(renderer.domElement)
    const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(backgrounds[viewerBackground], .002)
    const camera = new THREE.PerspectiveCamera(46, width / height, .1, 3000)
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.autoRotate = autoRotate; controls.autoRotateSpeed = .65
    scene.add(new THREE.HemisphereLight(0xbedcff, 0x201138, 2.1)); const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(150, 180, 260); key.castShadow = true; scene.add(key)
    const rim = new THREE.PointLight(0x9b77ff, 1200, 450); rim.position.set(-130, 30, 100); scene.add(rim)
    const built = createVisibleSurfaceGeometry(objectData, uploadedFile, depthScale, detail)
    const frontMaterial = new THREE.MeshStandardMaterial({ color: 0xe3e5ff, roughness: .62, metalness: .03, side: THREE.DoubleSide })
    const estimatedMaterial = new THREE.MeshStandardMaterial({ color: 0x5d3caf, roughness: .78, metalness: .04, transparent: true, opacity: .66, side: THREE.DoubleSide })
    if (showTexture && depthResult?.original_image_url) new THREE.TextureLoader().load(depthResult.original_image_url, texture => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = renderer.capabilities.getMaxAnisotropy(); frontMaterial.map = texture; frontMaterial.needsUpdate = true })
    const model = new THREE.Mesh(built.geometry, [frontMaterial, estimatedMaterial]); model.castShadow = true; model.receiveShadow = true; scene.add(model)
    let wireframe
    if (showWireframe) { wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(built.geometry), new THREE.LineBasicMaterial({ color: 0xd8c4ff, transparent: true, opacity: .28 })); scene.add(wireframe) }
    const grid = new THREE.GridHelper(Math.max(built.width, built.height) * 1.5, 20, 0x314d70, 0x16223b); grid.rotateX(Math.PI / 2); grid.position.z = built.geometry.boundingBox.min.z - Math.max(18, depthScale * .38); scene.add(grid)
    const frame = () => { const box = new THREE.Box3().setFromObject(model); const centre = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()); const distance = Math.max(size.x, size.y, size.z) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.48; camera.position.set(centre.x + size.x * .18, centre.y + size.y * .10, centre.z + Math.max(distance, 220)); camera.lookAt(centre); controls.target.copy(centre); controls.update() }
    frame()
    let animation; const animate = () => { animation = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }; animate()
    const resize = () => { const w = element.clientWidth || 800, h = element.clientHeight || 520; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h) }
    window.addEventListener('resize', resize)
    sceneRef.current = { renderer, camera, controls, animation, resize, frame, geometry: built.geometry, materials: [frontMaterial, estimatedMaterial], model, meshInfo: built }
  }
  function destroyScene() {
    const { renderer, animation, resize, geometry, materials } = sceneRef.current
    if (animation) cancelAnimationFrame(animation); if (resize) window.removeEventListener('resize', resize)
    geometry?.dispose(); materials?.forEach(material => { material.map?.dispose(); material.dispose() }); renderer?.dispose(); mountRef.current?.replaceChildren(); sceneRef.current = {}
  }
  useEffect(() => {
    if (!objectData || !mountRef.current) return undefined
    buildScene()
    return destroyScene
  }, [objectData, depthScale, detail, showTexture, showWireframe, autoRotate, viewerBackground])
  function fullscreen() { mountRef.current?.requestFullscreen?.() }
  async function exportGlb() {
    const model = sceneRef.current.model
    if (!model) return
    try {
      const output = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: true })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([output], { type: 'model/gltf-binary' }))
      link.download = `${uploadedFile.filename.replace(/\.[^.]+$/, '') || 'depthwizard-model'}-visible-surface.glb`
      link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (err) { setError(`GLB export failed: ${err.message || 'the mesh could not be serialized.'}`) }
  }
  if (textModel?.model_url) return <ProviderModelViewer model={textModel} />
  if (!fileId || !uploadedFile) return <div className="state-box"><Box size={48} className="state-icon" /><h3>Image required</h3><p>Upload a clear {copy.subject} image to begin.</p></div>
  if (!depthResult) return <div className="state-box"><ScanSearch size={48} className="state-icon" /><h3>Depth map required</h3><p>Generate a depth map before reconstructing the visible surface.</p></div>
  const stages = [['Image loaded', Boolean(uploadedFile)], ['Object / subject segmented', Boolean(objectData)], ['Depth generated', Boolean(depthResult)], ['Triangle mesh generated', Boolean(objectData)], ['Original texture projected', Boolean(objectData && depthResult.original_image_url)], ['3D model ready', Boolean(objectData)]]

  return <div className="object-workspace">
    <section className="card-panel object-controls"><div className="card-title"><h3><Sparkles size={18} /> {copy.title}</h3>{objectData && <span className="title-badge">TEXTURED TRIANGLE MESH</span>}</div><p className="object-note">{copy.single} Purple areas are a clearly marked estimated rear and side shell—one image cannot reveal them reliably.</p><div className="terrain-controls"><label>Depth Scale: {depthScale}<input type="range" min="25" max="180" value={depthScale} onChange={event => setDepthScale(Number(event.target.value))} /></label><label>Surface Detail: {detail.toFixed(1)}×<input type="range" min=".5" max="2.5" step=".1" value={detail} onChange={event => setDetail(Number(event.target.value))} /></label><button className="btn btn-primary" onClick={generateModel} disabled={loading}>{loading ? 'Creating geometry…' : objectData ? 'Rebuild 3D Mesh' : 'Generate 3D Mesh'}</button>{objectData && <><button className="btn btn-secondary" onClick={() => sceneRef.current.frame?.()}><RotateCcw size={16} /> Reset view</button><button className="btn btn-secondary" onClick={fullscreen}><Expand size={16} /> Fullscreen</button><button className="btn btn-secondary" onClick={exportGlb}><Download size={16} /> Export GLB</button>{canSave && <button className="btn btn-secondary" onClick={onSave}><BookmarkPlus size={16} /> Save</button>}</>}</div></section>
    {error && <div className="state-box error"><AlertCircle size={32} /><h3>Reconstruction error</h3><p>{error}</p><button className="btn btn-secondary" onClick={generateModel}>Retry reconstruction</button></div>}
    {objectData && <><section className="object-status"><div className="confidence-card"><span>Visible-surface confidence</span><strong>{Math.round(objectData.reconstruction_confidence * 100)}%</strong><div className="confidence-track"><i style={{ width: `${objectData.reconstruction_confidence * 100}%` }} /></div></div><div><strong>Segmentation:</strong> {objectData.segmentation_method}<br /><strong>Input views:</strong> {Object.keys(inputViews).length || 1} (the local mesh uses the front image)</div><p><strong>Estimated:</strong> {objectData.estimated_regions}</p></section><section className="viewer-options"><label><input type="checkbox" checked={showTexture} onChange={event => setShowTexture(event.target.checked)} /> Texture</label><label><input type="checkbox" checked={showWireframe} onChange={event => setShowWireframe(event.target.checked)} /> Wireframe</label><label><input type="checkbox" checked={autoRotate} onChange={event => setAutoRotate(event.target.checked)} /> Auto rotate</label><label>Backdrop <select value={viewerBackground} onChange={event => setViewerBackground(event.target.value)}><option value="studio">Studio</option><option value="navy">Navy</option><option value="violet">Violet</option><option value="pearl">Pearl</option></select></label></section><div className="terrain-canvas-wrap object-canvas" ref={mountRef} /><section className="before-after"><div><span>Original 2D image</span><img src={uploadedFile.localUrl} alt="Original object" /></div><div><span>Generated depth map</span><img src={depthResult.visual_depth_url} alt="Generated depth map" /></div><div className="model-summary"><span>Generated 3D model</span><strong>{objectData.grid_size} × {objectData.grid_size} mesh grid</strong><small>Triangle faces, vertex normals, texture coordinates, an original-image texture, and an explicitly estimated rear shell.</small></div></section></>}
    {!objectData && <div className="state-box"><Box size={48} className="state-icon" /><h3>Ready to create 3D geometry</h3><p>Depth values will be normalized, the foreground silhouette will be segmented, and an actual textured triangle mesh will be framed automatically.</p></div>}
    <section className="reconstruction-steps">{stages.map(([label, complete]) => <div key={label} className={complete ? 'complete' : ''}><i />{label}</div>)}</section>
  </div>
}

// The provider preview deliberately lives in the existing ObjectViewer module:
// generated GLBs and depth-derived meshes share the same Three.js controls,
// framing, lighting, wireframe, fullscreen, and download experience.
function ProviderModelViewer({ model }) {
  const mountRef = useRef(null)
  const runtime = useRef({})
  const [error, setError] = useState(null)
  const [modelLoading, setModelLoading] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  useEffect(() => {
    const host = mountRef.current; if (!host) return undefined
    const renderer = new THREE.WebGLRenderer({ antialias: true }); const width = host.clientWidth || 800, height = host.clientHeight || 520
    renderer.setSize(width, height); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; host.replaceChildren(renderer.domElement)
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x090b1d); const camera = new THREE.PerspectiveCamera(45, width / height, .1, 5000)
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.autoRotate = autoRotate; controls.autoRotateSpeed = .6
    scene.add(new THREE.HemisphereLight(0xc7dfff, 0x251242, 2.2)); const key = new THREE.DirectionalLight(0xffffff, 2.8); key.position.set(6, 10, 8); key.castShadow = true; scene.add(key); const fill = new THREE.PointLight(0x9b77ff, 35, 25); fill.position.set(-5, 2, 4); scene.add(fill)
    let loaded, wire
    const frame = target => { const box = new THREE.Box3().setFromObject(target); const centre = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()); const distance = Math.max(size.x, size.y, size.z, 1) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.5; camera.position.set(centre.x + distance * .35, centre.y + distance * .15, centre.z + distance); controls.target.copy(centre); camera.lookAt(centre); controls.update() }
    setModelLoading(true)
    new GLTFLoader().load(model.model_url, gltf => { loaded = gltf.scene; loaded.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true } }); scene.add(loaded); if (wireframe) { wire = new THREE.Group(); loaded.traverse(node => { if (node.isMesh) wire.add(new THREE.LineSegments(new THREE.WireframeGeometry(node.geometry), new THREE.LineBasicMaterial({ color: 0xcab8ff, transparent: true, opacity: .25 }))) }); scene.add(wire) } frame(loaded); runtime.current = { frame, loaded }; setModelLoading(false) }, undefined, () => { setModelLoading(false); setError('The generated GLB could not be loaded. Please regenerate the model.') })
    let animation; const animate = () => { animation = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }; animate()
    const resize = () => { const w = host.clientWidth || 800, h = host.clientHeight || 520; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h) }; window.addEventListener('resize', resize)
    runtime.current = { frame, loaded }
    return () => { cancelAnimationFrame(animation); window.removeEventListener('resize', resize); renderer.dispose(); host.replaceChildren() }
  }, [model.model_url, wireframe, autoRotate])
  function download() { const link = document.createElement('a'); link.href = model.model_url; link.download = 'depthwizard-text-to-3d.glb'; link.click() }
  return <div className="object-workspace"><section className="card-panel object-controls"><div className="card-title"><h3><Sparkles size={18} /> Generated Text-to-3D Model</h3><span className="title-badge">VALIDATED GLB</span></div><p className="object-note">This is the validated GLB returned by the configured local/self-hosted engine. Use the same controls as every DepthWizard 3D result.</p><div className="terrain-controls"><label><input type="checkbox" checked={wireframe} onChange={event => setWireframe(event.target.checked)} /> Wireframe</label><label><input type="checkbox" checked={autoRotate} onChange={event => setAutoRotate(event.target.checked)} /> Auto rotate</label><button className="btn btn-secondary" onClick={() => runtime.current.loaded && runtime.current.frame?.(runtime.current.loaded)} disabled={modelLoading}><RotateCcw size={16} /> Reset view</button><button className="btn btn-secondary" onClick={() => mountRef.current?.requestFullscreen?.()}><Expand size={16} /> Fullscreen</button><button className="btn btn-secondary" onClick={download} disabled={modelLoading}><Download size={16} /> Download GLB</button></div></section>{modelLoading && <p className="pipeline-stage">Loading validated GLB into the 3D viewer…</p>}{error && <div className="state-box error"><AlertCircle size={30} /><h3>Model preview error</h3><p>{error}</p></div>}<div className="terrain-canvas-wrap object-canvas" ref={mountRef} /></div>
}
