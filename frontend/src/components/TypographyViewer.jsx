import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'
import { Download, Expand, RotateCcw } from 'lucide-react'

const FONT_FILES = { Block: 'helvetiker_bold.typeface.json', Rounded: 'helvetiker_regular.typeface.json', Serif: 'optimer_regular.typeface.json', Elegant: 'gentilis_bold.typeface.json', Futuristic: 'helvetiker_bold.typeface.json' }
const FONT_CACHE = new Map()
const BACKGROUNDS = { 'Dark studio': { color: 0x070b18, alpha: 1 }, 'Deep violet': { color: 0x180a35, alpha: 1 }, 'Light studio': { color: 0xe9eefb, alpha: 1 }, Transparent: { color: 0x000000, alpha: 0 } }

function loadFont(fontStyle) {
  const name = FONT_FILES[fontStyle] || FONT_FILES.Block
  if (!FONT_CACHE.has(name)) FONT_CACHE.set(name, new Promise((resolve, reject) => new FontLoader().load(`/fonts/${name}`, resolve, undefined, reject)))
  return FONT_CACHE.get(name)
}

function materialFor(config) {
  const base = { color: new THREE.Color(config.color), metalness: config.metalness, roughness: config.roughness, side: THREE.DoubleSide }
  if (config.material === 'Matte') return new THREE.MeshStandardMaterial({ ...base, metalness: 0, roughness: Math.max(.7, config.roughness) })
  if (config.material === 'Glossy') return new THREE.MeshPhysicalMaterial({ ...base, metalness: .08, roughness: Math.min(.18, config.roughness), clearcoat: .75, clearcoatRoughness: .12 })
  if (config.material === 'Metallic') return new THREE.MeshStandardMaterial({ ...base, metalness: Math.max(.7, config.metalness), roughness: config.roughness })
  if (config.material === 'Chrome') return new THREE.MeshPhysicalMaterial({ ...base, color: 0xd8e4ff, metalness: 1, roughness: Math.min(.16, config.roughness), clearcoat: .8 })
  if (config.material === 'Gold') return new THREE.MeshPhysicalMaterial({ ...base, color: 0xf5bd3f, metalness: .95, roughness: Math.min(.28, config.roughness), clearcoat: .45 })
  if (config.material === 'Silver') return new THREE.MeshStandardMaterial({ ...base, color: 0xc9d0df, metalness: .92, roughness: Math.min(.32, config.roughness) })
  if (config.material === 'Neon') return new THREE.MeshStandardMaterial({ ...base, metalness: .05, roughness: .25, emissive: new THREE.Color(config.color), emissiveIntensity: 1.35 })
  if (config.material === 'Glass-like') return new THREE.MeshPhysicalMaterial({ ...base, metalness: .02, roughness: Math.min(.16, config.roughness), transmission: .42, transparent: true, opacity: .78, ior: 1.35, thickness: .3 })
  return new THREE.MeshStandardMaterial({ ...base, metalness: .08, roughness: Math.max(.24, config.roughness) })
}

function disposeObject(object) {
  const geometries = new Set(), materials = new Set()
  object?.traverse(child => { if (child.geometry) geometries.add(child.geometry); if (child.material) (Array.isArray(child.material) ? child.material : [child.material]).forEach(material => materials.add(material)) })
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose())
}

function createTextGroup(font, config) {
  const group = new THREE.Group(); group.name = 'Local 3D Typography'
  const frontMaterial = materialFor(config); const sideMaterial = frontMaterial.clone(); sideMaterial.color.multiplyScalar(.74)
  const edgeMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(config.color).lerp(new THREE.Color(0xffffff), .3), transparent: true, opacity: .92 })
  const parameters = { font, size: config.size, depth: Math.max(.035, config.depth), curveSegments: 8, bevelEnabled: config.meshStyle === 'Beveled' || config.bevel > 0, bevelThickness: Math.min(config.bevel, config.depth * .45), bevelSize: Math.min(config.bevel, config.size * .12), bevelSegments: 3 }
  const widthCache = new Map()
  function characterWidth(character) {
    if (character === ' ') return config.size * .33
    if (!widthCache.has(character)) { const geometry = new TextGeometry(character, parameters); geometry.computeBoundingBox(); const box = geometry.boundingBox; widthCache.set(character, Math.max(config.size * .16, box.max.x - box.min.x)); geometry.dispose() }
    return widthCache.get(character)
  }
  const maxWidth = Math.max(1, config.maxLineWidth)
  const lines = [[]]; let lineWidth = 0
  for (const character of config.text) {
    if (character === '\n') { lines.push([]); lineWidth = 0; continue }
    const advance = characterWidth(character) + config.letterSpacing
    if (character !== ' ' && lineWidth > 0 && lineWidth + advance > maxWidth) { lines.push([]); lineWidth = 0 }
    lines.at(-1).push({ character, advance }); lineWidth += advance
  }
  let vertices = 0, triangles = 0, characterCount = 0
  lines.forEach((line, lineIndex) => {
    const width = Math.max(0, line.reduce((total, item) => total + item.advance, 0) - config.letterSpacing)
    let x = config.alignment === 'Center' ? -width / 2 : config.alignment === 'Right' ? -width : 0
    const y = -lineIndex * config.size * config.lineSpacing
    line.forEach(({ character, advance }) => {
      if (character !== ' ') {
        const geometry = new TextGeometry(character, parameters); geometry.computeVertexNormals(); geometry.computeBoundingBox()
        const mesh = new THREE.Mesh(geometry, [frontMaterial, sideMaterial]); mesh.position.set(x, y, 0); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh)
        vertices += geometry.getAttribute('position').count; triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3; characterCount += 1
        if (config.meshStyle === 'Outline') { const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 18), edgeMaterial); edges.position.copy(mesh.position); edges.renderOrder = 2; group.add(edges) }
      }
      x += advance
    })
  })
  const bounds = new THREE.Box3().setFromObject(group); const center = bounds.getCenter(new THREE.Vector3()); group.position.sub(center)
  group.rotation.set(THREE.MathUtils.degToRad(config.rotationX), THREE.MathUtils.degToRad(config.rotationY), THREE.MathUtils.degToRad(config.rotationZ))
  group.userData.stats = { vertices, triangles, characters: characterCount }
  return group
}

export default function TypographyViewer({ config, validText, onMeshReady }) {
  const mountRef = useRef(null); const runtimeRef = useRef({}); const [error, setError] = useState(null); const [building, setBuilding] = useState(false)
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return undefined
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18; mount.replaceChildren(renderer.domElement)
    const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(42, 1, .01, 300); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = .4; controls.maxDistance = 80
    scene.add(new THREE.HemisphereLight(0xd3e9ff, 0x160928, 2.35)); const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(4, 7, 9); key.castShadow = true; scene.add(key); const rim = new THREE.PointLight(0x8b5cf6, 22, 18); rim.position.set(-4, 2, 4); scene.add(rim); const fill = new THREE.PointLight(0x22d3ee, 11, 14); fill.position.set(4, -1, 3); scene.add(fill)
    const grid = new THREE.GridHelper(20, 24, 0x46618d, 0x1d2e4a); scene.add(grid)
    const resize = () => { const width = mount.clientWidth || 800, height = mount.clientHeight || 520; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false) }; resize(); const animate = () => { runtimeRef.current.frame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera) }; animate(); window.addEventListener('resize', resize)
    runtimeRef.current = { renderer, scene, camera, controls, grid, resize, group: null, frame: runtimeRef.current.frame }
    return () => { cancelAnimationFrame(runtimeRef.current.frame); window.removeEventListener('resize', resize); disposeObject(runtimeRef.current.group); renderer.dispose(); mount.replaceChildren(); runtimeRef.current = {} }
  }, [])
  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime.renderer) return undefined
    const background = BACKGROUNDS[config.background] || BACKGROUNDS['Dark studio']; runtime.renderer.setClearColor(background.color, background.alpha); runtime.scene.background = background.alpha ? new THREE.Color(background.color) : null; runtime.grid.visible = config.showGrid; runtime.controls.autoRotate = config.autoRotate
  }, [config.background, config.showGrid, config.autoRotate])
  useEffect(() => {
    const runtime = runtimeRef.current; if (!runtime.scene) return undefined
    let cancelled = false; const timer = window.setTimeout(async () => {
      if (!validText) { disposeObject(runtime.group); runtime.scene.remove(runtime.group); runtime.group = null; onMeshReady?.(null); return }
      setBuilding(true); setError(null)
      try {
        const font = await loadFont(config.fontStyle); if (cancelled) return
        const group = createTextGroup(font, config); disposeObject(runtime.group); runtime.scene.remove(runtime.group); runtime.group = group; runtime.scene.add(group)
        const box = new THREE.Box3().setFromObject(group); const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()); const largest = Math.max(size.x, size.y, size.z, 1); const distance = largest / (2 * Math.tan(THREE.MathUtils.degToRad(runtime.camera.fov / 2))) * 1.48
        runtime.camera.position.set(center.x + largest * .22, center.y + largest * .1, center.z + Math.max(distance, 2.6)); runtime.controls.target.copy(center); runtime.controls.update(); runtime.grid.position.set(center.x, box.min.y - Math.max(.3, size.y * .15), center.z); onMeshReady?.(group.userData.stats)
      } catch (buildError) { if (!cancelled) { setError(`Could not create the local text mesh: ${buildError.message || 'font loading failed.'}`); onMeshReady?.(null) } } finally { if (!cancelled) setBuilding(false) }
    }, 120)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [config, validText, onMeshReady])
  function resetCamera() { const runtime = runtimeRef.current; const group = runtime.group; if (!group) return; const box = new THREE.Box3().setFromObject(group); const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3()); const largest = Math.max(size.x, size.y, size.z, 1); const distance = largest / (2 * Math.tan(THREE.MathUtils.degToRad(runtime.camera.fov / 2))) * 1.48; runtime.camera.position.set(center.x + largest * .22, center.y + largest * .1, center.z + Math.max(distance, 2.6)); runtime.controls.target.copy(center); runtime.controls.update() }
  async function exportGlb() { const group = runtimeRef.current.group; if (!group) return; try { const output = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true }); const url = URL.createObjectURL(new Blob([output], { type: 'model/gltf-binary' })); const link = document.createElement('a'); link.href = url; link.download = `${config.text.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || '3d-typography'}.glb`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500) } catch (exportError) { setError(`GLB export failed: ${exportError.message || 'the local mesh could not be serialized.'}`) } }
  return <section className="typography-viewer-shell"><div className="typography-viewer-toolbar"><span>{building ? 'Building local geometry…' : validText ? '3D mesh preview' : 'Enter supported text to preview'}</span><div><button className="btn btn-secondary" onClick={resetCamera} disabled={!validText}><RotateCcw size={15} /> Reset camera</button><button className="btn btn-secondary" onClick={() => mountRef.current?.requestFullscreen?.()}><Expand size={15} /> Fullscreen</button><button className="btn btn-primary" onClick={exportGlb} disabled={!validText || building}><Download size={15} /> Download GLB</button></div></div><div className="typography-canvas" ref={mountRef} />{error && <p className="typography-viewer-error">{error}</p>}</section>
}
