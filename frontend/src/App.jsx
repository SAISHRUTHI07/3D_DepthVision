import { useEffect, useState } from 'react'
import { Upload, Layers, Settings, Box, Play, BarChart2, Activity, Palette, Sparkles, PersonStanding, WandSparkles } from 'lucide-react'
import UploadPanel from './components/UploadPanel'
import DepthPanel from './components/DepthPanel'
import CalibrationPanel from './components/CalibrationPanel'
import TerrainViewer from './components/TerrainViewer'
import FlythroughPanel from './components/FlythroughPanel'
import AnalyticsPanel from './components/AnalyticsPanel'
import AuthDialog from './components/AuthDialog'
import ObjectViewer from './components/ObjectViewer'
import AppearanceDialog from './components/AppearanceDialog'
import TextTo3DPanel from './components/TextTo3DPanel'
import './App.css'

const TERRAIN_MENU = [
  { key: 'upload', label: 'Upload Image', icon: Upload }, { key: 'depth', label: 'Depth Analysis', icon: Layers },
  { key: 'calibration', label: 'Calibration', icon: Settings }, { key: 'terrain', label: '3D Terrain', icon: Box },
  { key: 'flythrough', label: 'Flythrough', icon: Play }, { key: 'analytics', label: 'Project Analytics', icon: BarChart2 },
]
const MESH_MENU = [
  { key: 'upload', label: 'Image Inputs', icon: Upload }, { key: 'depth', label: 'Depth Analysis', icon: Layers },
  { key: 'object', label: '3D Reconstruction', icon: Box }, { key: 'analytics', label: 'Project Analytics', icon: BarChart2 },
]
const MODES = [
  { key: 'terrain', label: '3D Terrain', icon: Box, tab: 'terrain', description: 'Aerial and map imagery' },
  { key: 'object', label: '3D Object', icon: Sparkles, tab: 'object', description: 'Buildings and products' },
  { key: 'human', label: '3D Human', icon: PersonStanding, tab: 'object', description: 'People and portraits' },
  { key: 'anime', label: '3D Character', icon: WandSparkles, tab: 'object', description: 'Anime and stylized art' },
  { key: 'text', label: 'Text to 3D', icon: Layers, tab: 'text', description: 'Requires a configured model' },
]
const TITLES = { upload: 'Image Inputs', depth: 'Depth Analysis', calibration: 'Elevation Calibration', terrain: '3D Terrain Viewer', flythrough: '3D Flythrough Mode', analytics: 'Project Analytics', object: '3D Reconstruction', text: 'Text to 3D' }

export default function App() {
  const [activeTab, setActiveTab] = useState('upload')
  const [backendOk, setBackendOk] = useState(null)
  const [backendInfo, setBackendInfo] = useState(null)
  const [fileId, setFileId] = useState(null)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [depthResult, setDepthResult] = useState(null)
  const [calibResult, setCalibResult] = useState(null)
  const [terrainData, setTerrainData] = useState(null)
  const [analyticsData, setAnalyticsData] = useState(null)
  const [objectData, setObjectData] = useState(null)
  const [inputAnalysis, setInputAnalysis] = useState(null)
  const [reconstructionMode, setReconstructionMode] = useState('terrain')
  const [inputViews, setInputViews] = useState({})
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem('depthvision-profile')) } catch { return null } })
  const [showAuth, setShowAuth] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [history, setHistory] = useState([])
  const [theme, setTheme] = useState(() => localStorage.getItem('depthvision-theme') || 'midnight')

  useEffect(() => { localStorage.setItem('depthvision-theme', theme) }, [theme])
  useEffect(() => {
    if (!profile?.email) { setHistory([]); return }
    try { setHistory(JSON.parse(localStorage.getItem(`depthvision-history:${profile.email}`)) || []) } catch { setHistory([]) }
  }, [profile])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error('Health check failed'); return response.json() })
      .then(data => { setBackendOk(true); setBackendInfo(data) })
      .catch(error => { if (error.name !== 'AbortError') setBackendOk(false) })
    return () => controller.abort()
  }, [])

  function saveProfile(nextProfile) { localStorage.setItem('depthvision-profile', JSON.stringify(nextProfile)); setProfile(nextProfile); setShowAuth(false) }
  function signOut() { localStorage.removeItem('depthvision-profile'); setProfile(null); setShowHistory(false) }
  function saveProjectToHistory(info = uploadedFile, type = reconstructionMode, metadata = {}) {
    if (!profile?.email || !info?.fileId) return
    const key = `depthvision-history:${profile.email}`
    if (history.some(item => item.fileId === info.fileId && item.type === type)) return
    const entry = { id: crypto.randomUUID(), fileId: info.fileId, type, filename: info.filename, width: info.width, height: info.height, createdAt: new Date().toISOString(), inputViewCount: Object.keys(inputViews).length || 1, ...metadata }
    const next = [entry, ...history].slice(0, 30)
    localStorage.setItem(key, JSON.stringify(next)); setHistory(next)
  }
  function selectMode(mode) {
    setReconstructionMode(mode.key)
    // New image-driven modes begin at their guided input screen.  If an image
    // is already loaded, take the user straight to the reconstruction viewer.
    setActiveTab(mode.key === 'text' ? 'text' : mode.key === 'terrain' ? 'terrain' : uploadedFile ? 'object' : 'upload')
  }
  function resetForNewImage(id, info) { setFileId(id); setUploadedFile(info); setDepthResult(null); setCalibResult(null); setTerrainData(null); setObjectData(null); setAnalyticsData(null); setInputAnalysis(null); setInputViews({ front: info }) }
  function completeObject(data) { setObjectData(data); saveProjectToHistory(uploadedFile, reconstructionMode, { confidence: data.reconstruction_confidence, model: data.model_type || 'Depth Anything visible-surface mesh' }) }
  function completeTerrain(data) { setTerrainData(data); saveProjectToHistory(uploadedFile, 'terrain', { model: depthResult?.model_name, confidence: data.stats?.confidence_max }) }

  const menu = reconstructionMode === 'terrain' ? TERRAIN_MENU : MESH_MENU
  const currentMode = MODES.find(mode => mode.key === reconstructionMode)
  const title = activeTab === 'object' ? (currentMode?.label || TITLES.object) : TITLES[activeTab]

  return <div className="dashboard-container" data-theme={theme}>
    <aside className="sidebar">
      <div className="sidebar-logo"><h1>3D DepthVision</h1><span>SIH26175 · SINGLE-VIEW DEPTH & FLYTHROUGH</span></div>
      <div className="mode-picker" aria-label="Reconstruction mode">
        {MODES.map(({ key, label, icon: Icon, description, ...mode }) => <button key={key} className={reconstructionMode === key ? 'selected' : ''} onClick={() => selectMode({ key, ...mode })} title={description}><Icon size={15} /><span>{label}</span></button>)}
      </div>
      <ul className="sidebar-menu">{menu.map(({ key, label, icon: Icon }) => <li key={key} className={`menu-item ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}><Icon size={18} />{label}</li>)}</ul>
      <div className="sidebar-footer"><div className="meta-list">
        <div className="meta-row"><span className="meta-label">Input</span><span className={`meta-value ${uploadedFile ? 'highlight' : ''}`}>{uploadedFile ? 'Loaded' : '—'}</span></div>
        <div className="meta-row"><span className="meta-label">Depth</span><span className={`meta-value ${depthResult ? 'highlight' : ''}`}>{depthResult ? 'Ready' : '—'}</span></div>
        <div className="meta-row"><span className="meta-label">Model</span><span className={`meta-value ${objectData || terrainData ? 'highlight' : ''}`}>{objectData || terrainData ? 'Ready' : '—'}</span></div>
      </div></div>
    </aside>
    <div className="main-workspace">
      <header className="main-header"><div className="header-title"><p className="header-mode">{currentMode?.label}</p><h2>{title}</h2></div><div className="header-status">
        <div className="connection-badge"><span className={`badge-dot ${backendOk ? 'connected' : ''}`} />{backendOk === null ? 'Connecting…' : backendOk ? 'Backend Online' : 'Backend Offline'}</div>
        {backendInfo?.hardware && <div className="connection-badge"><Activity size={13} />{backendInfo.hardware.gpu_available ? `GPU: ${backendInfo.hardware.gpu_name}` : 'Automatic compute'}</div>}
        <button className="header-action" onClick={() => setShowAppearance(true)} title="Appearance"><Palette size={14} /> Appearance</button>
        {profile ? <><button className="header-action" onClick={() => setShowHistory(true)}>History</button><button className="header-action profile-action" onClick={signOut}>{profile.name}</button></> : <button className="header-action primary-action" onClick={() => setShowAuth(true)}>Sign in</button>}
      </div></header>
      <main className="content-area">
        {activeTab === 'upload' && <UploadPanel mode={reconstructionMode} onUploaded={resetForNewImage} fileId={fileId} uploadedFile={uploadedFile} inputAnalysis={inputAnalysis} onInputAnalysis={setInputAnalysis} inputViews={inputViews} onInputViewsChange={setInputViews} />}
        {activeTab === 'depth' && <DepthPanel fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} mode={reconstructionMode} inputViewCount={Object.keys(inputViews).length || 1} onDepthDone={result => { setDepthResult(result); setTerrainData(null); setObjectData(null) }} />}
        {activeTab === 'calibration' && <CalibrationPanel fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} calibResult={calibResult} onCalibDone={result => { setCalibResult(result); setTerrainData(null) }} />}
        {activeTab === 'terrain' && <TerrainViewer fileId={fileId} depthResult={depthResult} terrainData={terrainData} onTerrainLoaded={completeTerrain} onPointClick={(x, y) => { const scaleX = uploadedFile?.width / Math.max((terrainData?.grid_size ?? 1) - 1, 1); const scaleY = uploadedFile?.height / Math.max((terrainData?.grid_size ?? 1) - 1, 1); setAnalyticsData({ x: Math.min(uploadedFile?.width - 1, Math.max(0, Math.round(x * scaleX))), y: Math.min(uploadedFile?.height - 1, Math.max(0, Math.round(y * scaleY))), fileId }) }} onSave={() => saveProjectToHistory(uploadedFile, 'terrain')} canSave={Boolean(profile)} />}
        {activeTab === 'flythrough' && <FlythroughPanel fileId={fileId} depthResult={depthResult} terrainData={terrainData} onTerrainLoaded={completeTerrain} onExit={() => setActiveTab('terrain')} />}
        {activeTab === 'object' && <ObjectViewer fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} objectData={objectData} mode={reconstructionMode} inputViews={inputViews} onObjectLoaded={completeObject} onSave={() => saveProjectToHistory(uploadedFile, reconstructionMode)} canSave={Boolean(profile)} />}
        {activeTab === 'text' && <TextTo3DPanel />}
        {activeTab === 'analytics' && <AnalyticsPanel fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} initialPoint={analyticsData} objectData={objectData} terrainData={terrainData} inputAnalysis={inputAnalysis} history={history} reconstructionMode={reconstructionMode} inputViewCount={Object.keys(inputViews).length || 1} onSave={() => saveProjectToHistory(uploadedFile, reconstructionMode)} canSave={Boolean(profile)} />}
      </main>
    </div>
    <AuthDialog open={showAuth} onClose={() => setShowAuth(false)} onSave={saveProfile} />
    <AppearanceDialog open={showAppearance} theme={theme} onSelect={setTheme} onClose={() => setShowAppearance(false)} />
    {showHistory && <div className="modal-backdrop" onMouseDown={() => setShowHistory(false)}><section className="auth-dialog history-dialog" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHistory(false)} aria-label="Close history">×</button><p className="eyebrow">SAVED PROJECT HISTORY</p><h3>Completed reconstructions</h3>{history.length ? <div className="history-list">{history.map(item => <div className="history-item" key={item.id}><strong>{item.filename}</strong><span>{item.type} · {item.width} × {item.height}px · {item.inputViewCount || 1} view(s) · {new Date(item.createdAt).toLocaleString()}</span></div>)}</div> : <p className="dialog-copy">Completed reconstructions and manually saved projects appear here after you sign in.</p>}</section></div>}
  </div>
}
