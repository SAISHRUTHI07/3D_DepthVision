import { useMemo, useState } from 'react'
import { AlertCircle, BookmarkPlus, Box, RotateCcw, SlidersHorizontal, Type } from 'lucide-react'
import TypographyViewer from './TypographyViewer'

const FONT_STYLES = ['Block', 'Rounded', 'Serif', 'Elegant', 'Futuristic']
const MESH_STYLES = ['Solid', 'Outline', 'Extruded', 'Beveled']
const MATERIALS = ['Matte', 'Glossy', 'Metallic', 'Chrome', 'Gold', 'Silver', 'Neon', 'Glass-like', 'Plastic']
const BACKGROUNDS = ['Dark studio', 'Deep violet', 'Light studio', 'Transparent']
const PRESETS = ['#ffffff', '#101827', '#5d5fef', '#a855f7', '#ef4444', '#f59e0b', '#22c55e', '#22d3ee']
const DEFAULTS = { text: '3DV', fontStyle: 'Block', meshStyle: 'Beveled', material: 'Chrome', color: '#5d5fef', depth: .42, bevel: .055, size: 1.2, letterSpacing: .035, lineSpacing: 1.15, maxLineWidth: 8, alignment: 'Center', metalness: .82, roughness: .2, rotationX: 0, rotationY: -12, rotationZ: 0, background: 'Dark studio', showGrid: true, autoRotate: false }

function number(value) { return Number(value) }

export default function TextTo3DPanel({ onSaveProject, canSave }) {
  const [settings, setSettings] = useState(DEFAULTS)
  const [meshInfo, setMeshInfo] = useState(null)
  const update = (key, value) => setSettings(current => ({ ...current, [key]: value }))
  const normalizedText = settings.text.replace(/\r/g, '')
  const invalidCharacters = /[^A-Za-z0-9 .,!?'":;()\-_/&+\n]/.test(normalizedText)
  const validText = normalizedText.trim().length > 0 && normalizedText.length <= 80 && !invalidCharacters
  const config = useMemo(() => ({ ...settings, text: normalizedText }), [settings, normalizedText])

  function reset() { setSettings(DEFAULTS); setMeshInfo(null) }
  function save() { if (canSave && validText) onSaveProject?.({ ...config, meshInfo, status: 'Local mesh ready' }) }

  return <div className="text-to-3d typography-generator local-typography">
    <section className="card-panel text-hero typography-hero"><div><p className="eyebrow">3DV · LOCAL THREE.JS TYPOGRAPHY</p><h3><Type size={21} /> 3D Typography Studio</h3><p>Create real editable 3D letter geometry locally in your browser. No API key, cloud service, or remote generation is used.</p></div><div className="hero-glyph" aria-hidden="true">3D</div></section>
    <div className="local-status" role="status"><Box size={17} /><span><strong>Local geometry engine ready.</strong> Text is built as vertices, triangle faces, normals, and materials directly in Three.js.</span></div>
    <section className="typography-workflow"><span>1. Type text</span><span>2. Choose a font</span><span>3. Shape the mesh</span><span>4. Adjust material</span><span>5. Export GLB</span></section>
    <section className="card-panel typography-form local-typography-form">
      <label className="prompt-label">Text to convert into 3D geometry<textarea value={settings.text} onChange={event => update('text', event.target.value)} placeholder="A · 3DV · SHRUTHI · HELLO WORLD" rows="3" maxLength="80" spellCheck="false" /><small>{normalizedText.length}/80 characters · Basic Latin letters, numbers, spaces, and punctuation are supported. Use a line break for an intentional new line.</small></label>
      {!validText && <div className="inline-validation"><AlertCircle size={15} />{invalidCharacters ? 'Use basic Latin letters, numbers, spaces, and simple punctuation only.' : 'Enter up to 80 supported characters to create the mesh.'}</div>}
      <div className="text-selectors typography-selectors local-selectors">
        <label>Font style<select value={settings.fontStyle} onChange={event => update('fontStyle', event.target.value)}>{FONT_STYLES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Mesh style<select value={settings.meshStyle} onChange={event => update('meshStyle', event.target.value)}>{MESH_STYLES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Material preset<select value={settings.material} onChange={event => update('material', event.target.value)}>{MATERIALS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Alignment<select value={settings.alignment} onChange={event => update('alignment', event.target.value)}><option>Left</option><option>Center</option><option>Right</option></select></label>
        <label>Viewer background<select value={settings.background} onChange={event => update('background', event.target.value)}>{BACKGROUNDS.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <section className="typography-color"><div><strong>Text colour</strong><span>Applied to the actual local mesh material.</span></div><input type="color" value={settings.color} onChange={event => update('color', event.target.value)} aria-label="Typography colour" /><input value={settings.color} onChange={event => update('color', event.target.value)} maxLength="7" aria-label="Hex colour" />{PRESETS.map(value => <button type="button" key={value} title={value} className={settings.color.toLowerCase() === value ? 'selected' : ''} style={{ background: value }} onClick={() => update('color', value)} />)}</section>
      <section className="local-control-grid" aria-label="3D typography controls">
        <Range label="Text size" value={settings.size} min=".45" max="2.4" step=".05" suffix="×" onChange={value => update('size', number(value))} />
        <Range label="Extrusion depth" value={settings.depth} min=".05" max="1.4" step=".01" suffix="" onChange={value => update('depth', number(value))} />
        <Range label="Bevel amount" value={settings.bevel} min="0" max=".2" step=".005" suffix="" onChange={value => update('bevel', number(value))} />
        <Range label="Letter spacing" value={settings.letterSpacing} min="-.08" max=".25" step=".005" suffix="" onChange={value => update('letterSpacing', number(value))} />
        <Range label="Line spacing" value={settings.lineSpacing} min=".8" max="2" step=".05" suffix="×" onChange={value => update('lineSpacing', number(value))} />
        <Range label="Maximum line width" value={settings.maxLineWidth} min="2.5" max="16" step=".5" suffix="" onChange={value => update('maxLineWidth', number(value))} />
        <Range label="Metalness" value={settings.metalness} min="0" max="1" step=".05" suffix="" onChange={value => update('metalness', number(value))} />
        <Range label="Roughness" value={settings.roughness} min="0" max="1" step=".05" suffix="" onChange={value => update('roughness', number(value))} />
        <Range label="Rotate X" value={settings.rotationX} min="-180" max="180" step="1" suffix="°" onChange={value => update('rotationX', number(value))} />
        <Range label="Rotate Y" value={settings.rotationY} min="-180" max="180" step="1" suffix="°" onChange={value => update('rotationY', number(value))} />
        <Range label="Rotate Z" value={settings.rotationZ} min="-180" max="180" step="1" suffix="°" onChange={value => update('rotationZ', number(value))} />
      </section>
      <div className="typography-actions"><label className="toggle-option"><input type="checkbox" checked={settings.showGrid} onChange={event => update('showGrid', event.target.checked)} /> Show grid</label><label className="toggle-option"><input type="checkbox" checked={settings.autoRotate} onChange={event => update('autoRotate', event.target.checked)} /> Auto rotate</label><button type="button" className="btn btn-secondary" onClick={reset}><RotateCcw size={16} /> Reset controls</button>{canSave && <button type="button" className="btn btn-secondary" onClick={save} disabled={!validText}><BookmarkPlus size={16} /> Save project</button>}</div>
    </section>
    <section className="typography-ready-card"><div><SlidersHorizontal size={18} /><span><strong>Live local preview</strong><small>{meshInfo ? `${meshInfo.characters} characters · ${meshInfo.vertices.toLocaleString()} vertices · ${meshInfo.triangles.toLocaleString()} triangles` : 'Updating mesh…'}</small></span></div><p>Rotate, zoom, and pan with the mouse. The visible text is generated geometry—not an image or a coloured depth map.</p></section>
    <TypographyViewer config={config} validText={validText} onMeshReady={setMeshInfo} />
  </div>
}

function Range({ label, value, min, max, step, suffix, onChange }) {
  return <label className="range-control"><span>{label}<strong>{Number(value).toFixed(step < .1 ? 2 : step < 1 ? 1 : 0)}{suffix}</strong></span><input type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(event.target.value)} /></label>
}
