import { useEffect, useState } from 'react'
import { Activity, Aperture, BarChart2, Box, Crosshair, History, Home, Image, Layers, LockKeyhole, Map, Palette, PersonStanding, Play, Settings, Type } from 'lucide-react'
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
import QueryPanel from './components/QueryPanel'
import HomeDashboard from './components/HomeDashboard'
import './App.css'

const MODES = [
  { key: 'object', label: '3D Object', icon: Box, description: 'Products and physical objects' },
  { key: 'terrain', label: '3D Terrain', icon: Map, description: 'Maps and landscapes' },
  { key: 'character', label: '3D Character', icon: PersonStanding, description: 'Portraits and people' },
  { key: 'scene', label: '3D Image / Scene', icon: Image, description: 'General spatial images' },
  { key: 'text', label: 'Text to 3D', icon: Type, description: 'Local 3D typography' },
]
const TERRAIN_MENU = [{ key: 'input', label: 'Terrain Input', icon: Image }, { key: 'depth', label: 'Depth Analysis', icon: Layers }, { key: 'calibration', label: 'Elevation Calibration', icon: Settings }, { key: 'terrain', label: '3D Terrain', icon: Box }, { key: 'flythrough', label: 'Flythrough', icon: Play }, { key: 'query', label: 'Point Query', icon: Crosshair }, { key: 'analytics', label: 'Analytics', icon: BarChart2 }]
const RECONSTRUCTION_MENU = [{ key: 'input', label: 'Input Setup', icon: Image }, { key: 'depth', label: 'Depth Analysis', icon: Layers }, { key: 'object', label: '3D Reconstruction', icon: Box }, { key: 'analytics', label: 'Analytics', icon: BarChart2 }]
const TITLES = { home: '2D → 3D AI Reconstruction Studio', input: 'Input Setup', depth: 'Depth Analysis', calibration: 'Elevation Calibration', terrain: '3D Terrain Viewer', flythrough: '3D Flythrough', query: 'Point Query', analytics: 'Project Analytics', object: '3D Reconstruction', text: '3D Typography Studio' }

function readHistory(email) { try { return email ? JSON.parse(localStorage.getItem(`depthvision-history:${email}`)) || [] : [] } catch { return [] } }
function modeLabel(mode) { return MODES.find(item => item.key === mode)?.label || '3D Reconstruction' }

export default function App() {
  const [activeTab, setActiveTab] = useState('home')
  const [reconstructionMode, setReconstructionMode] = useState('terrain')
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
  const [inputViews, setInputViews] = useState({})
  const [inputType, setInputType] = useState('single')
  const [characterStyle, setCharacterStyle] = useState('Realistic')
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem('depthvision-profile')) } catch { return null } })
  const [showAuth, setShowAuth] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [history, setHistory] = useState(() => readHistory(profile?.email))
  const [theme, setTheme] = useState(() => localStorage.getItem('depthvision-theme') || 'midnight')

  useEffect(() => { localStorage.setItem('depthvision-theme', theme) }, [theme])
  useEffect(() => { const controller = new AbortController(); fetch('/api/health', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error('Health check failed'); return response.json() }).then(data => { setBackendOk(true); setBackendInfo(data) }).catch(error => { if (error.name !== 'AbortError') setBackendOk(false) }); return () => controller.abort() }, [])

  function saveProfile(nextProfile) { localStorage.setItem('depthvision-profile', JSON.stringify(nextProfile)); setProfile(nextProfile); setHistory(readHistory(nextProfile.email)); setShowAuth(false) }
  function signOut() { localStorage.removeItem('depthvision-profile'); setProfile(null); setHistory([]); setShowHistory(false) }
  function saveProjectToHistory(info = uploadedFile, type = reconstructionMode, metadata = {}) { if (!profile?.email || !info?.fileId) return; const key = `depthvision-history:${profile.email}`; if (history.some(item => item.fileId === info.fileId && item.type === type)) return; const entry = { id: crypto.randomUUID(), fileId: info.fileId, type, filename: info.filename, width: info.width, height: info.height, inputType, inputViewCount: Object.keys(inputViews).length || 1, createdAt: new Date().toISOString(), ...metadata }; const next = [entry, ...history].slice(0, 30); localStorage.setItem(key, JSON.stringify(next)); setHistory(next) }
  function saveTypographyToHistory(project) { if (!profile?.email || !project?.text?.trim()) return; const key = `depthvision-history:${profile.email}`; const entry = { id: crypto.randomUUID(), type: 'text', filename: project.text.trim(), text: project.text.trim(), style: `${project.fontStyle} · ${project.meshStyle}`, material: project.material, status: project.status || 'Local mesh ready', local: true, createdAt: new Date().toISOString() }; const next = [entry, ...history].slice(0, 30); localStorage.setItem(key, JSON.stringify(next)); setHistory(next) }
  function deleteHistory(id) { const next = history.filter(item => item.id !== id); if (profile?.email) localStorage.setItem(`depthvision-history:${profile.email}`, JSON.stringify(next)); setHistory(next) }
  function renameHistory(id) { const item = history.find(entry => entry.id === id); const name = window.prompt('Rename saved project', item?.text || item?.filename || ''); if (!name?.trim()) return; const next = history.map(entry => entry.id === id ? { ...entry, filename: name.trim(), text: entry.text ? name.trim() : undefined } : entry); if (profile?.email) localStorage.setItem(`depthvision-history:${profile.email}`, JSON.stringify(next)); setHistory(next) }
  function openHistoryItem(item) { const mode = MODES.some(entry => entry.key === item.type) ? item.type : 'object'; setReconstructionMode(mode); setActiveTab(mode === 'text' ? 'text' : mode === 'terrain' ? 'terrain' : 'object'); setShowHistory(false) }
  function chooseMode(mode) { setReconstructionMode(mode); setInputType('single'); setActiveTab(mode === 'text' ? 'text' : 'input') }
  function resetForNewImage(id, info) { setFileId(id); setUploadedFile(info); setDepthResult(null); setCalibResult(null); setTerrainData(null); setObjectData(null); setAnalyticsData(null); setInputAnalysis(null); setInputViews({ single: info }) }
  function completeObject(data) { setObjectData(data) }
  function completeTerrain(data) { setTerrainData(data) }

  const isText = reconstructionMode === 'text'; const menu = reconstructionMode === 'terrain' ? TERRAIN_MENU : RECONSTRUCTION_MENU; const title = activeTab === 'object' ? `${modeLabel(reconstructionMode)} Viewer` : TITLES[activeTab]
  return <div className="dashboard-container" data-theme={theme}>
    <aside className="sidebar"><button className="sidebar-logo" onClick={() => setActiveTab('home')}><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><Aperture size={23} /><i /></span><h1>3D DepthVision</h1></div></button>
      <button className={`home-nav ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}><Home size={16} /> Home</button>
      <p className="sidebar-section-label">3D EXPERIENCES</p><div className="mode-picker" aria-label="3D experience">{MODES.map(({ key, label, icon: Icon, description }) => <button key={key} className={reconstructionMode === key && activeTab !== 'home' ? 'selected' : ''} onClick={() => chooseMode(key)} title={description}><Icon size={15} /><span>{label}</span></button>)}</div>
      {activeTab !== 'home' && !isText && <ul className="sidebar-menu">{menu.map(({ key, label, icon: Icon }) => <li key={key} className={`menu-item ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}><Icon size={18} />{label}</li>)}</ul>}
      <div className="sidebar-history-card"><div className="rail-card-title"><History size={17} /><span>History</span></div>{profile ? <><p className="rail-history-owner">Saved for {profile.name}</p>{history.length ? <div className="rail-history-list">{history.slice(0, 3).map(item => <button key={item.id} className="rail-history-item" onClick={() => setShowHistory(true)}><strong>{item.text || item.filename}</strong><span>{modeLabel(item.type)} · {new Date(item.createdAt).toLocaleDateString()}</span></button>)}</div> : <p className="rail-history-empty">No saved projects yet.</p>}<button className="rail-history-action" onClick={() => setShowHistory(true)}>View history</button></> : <><LockKeyhole className="rail-lock" size={20} aria-hidden="true" /><p className="rail-history-empty">Save projects after signing in.</p><button className="rail-history-action" onClick={() => setShowAuth(true)}>Login to show history</button></>}</div>
      <div className="sidebar-footer"><div className="meta-list"><div className="meta-row"><span className="meta-label">Input</span><span className={`meta-value ${uploadedFile ? 'highlight' : ''}`}>{uploadedFile ? 'Loaded' : '—'}</span></div><div className="meta-row"><span className="meta-label">Depth</span><span className={`meta-value ${depthResult ? 'highlight' : ''}`}>{depthResult ? 'Ready' : '—'}</span></div><div className="meta-row"><span className="meta-label">Model</span><span className={`meta-value ${objectData || terrainData ? 'highlight' : ''}`}>{objectData || terrainData ? 'Ready' : '—'}</span></div></div></div>
    </aside>
    <div className="main-workspace"><header className="main-header"><div className="header-title"><p className="header-mode">{activeTab === 'home' ? 'WELCOME' : modeLabel(reconstructionMode)}</p><h2>{title}</h2></div><div className="header-status"><div className="connection-badge" title={backendOk === false ? 'The FastAPI health request failed. Start backend/start-backend.ps1 on port 8000.' : undefined}><span className={`badge-dot ${backendOk ? 'connected' : ''}`} />{backendOk === null ? 'Connecting…' : backendOk ? 'Backend Online' : 'Backend Offline'}</div>{backendInfo?.hardware && <div className="connection-badge"><Activity size={13} />{backendInfo.hardware.gpu_available ? `GPU: ${backendInfo.hardware.gpu_name}` : 'Automatic compute'}</div>}<button className="header-action" onClick={() => setShowAppearance(true)}><Palette size={14} /> Appearance</button>{profile ? <button className="header-action profile-action" onClick={signOut}>{profile.name}</button> : <button className="header-action primary-action" onClick={() => setShowAuth(true)}>Sign in</button>}</div></header>
      <main className="content-area">{activeTab === 'home' && <HomeDashboard onChoose={chooseMode} />}{activeTab === 'input' && <UploadPanel mode={reconstructionMode} inputType={inputType} onInputTypeChange={setInputType} characterStyle={characterStyle} onCharacterStyleChange={setCharacterStyle} onUploaded={resetForNewImage} uploadedFile={uploadedFile} inputAnalysis={inputAnalysis} onInputAnalysis={setInputAnalysis} inputViews={inputViews} onInputViewsChange={setInputViews} />}{activeTab === 'depth' && <DepthPanel fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} mode={reconstructionMode} inputViewCount={Object.keys(inputViews).length || 1} onDepthDone={result => { setDepthResult(result); setTerrainData(null); setObjectData(null) }} />}{activeTab === 'calibration' && <CalibrationPanel fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} calibResult={calibResult} onCalibDone={result => { setCalibResult(result); setTerrainData(null) }} />}{activeTab === 'terrain' && <TerrainViewer fileId={fileId} depthResult={depthResult} terrainData={terrainData} onTerrainLoaded={completeTerrain} onPointClick={(x, y) => { const scaleX = uploadedFile?.width / Math.max((terrainData?.grid_size ?? 1) - 1, 1); const scaleY = uploadedFile?.height / Math.max((terrainData?.grid_size ?? 1) - 1, 1); setAnalyticsData({ x: Math.min(uploadedFile?.width - 1, Math.max(0, Math.round(x * scaleX))), y: Math.min(uploadedFile?.height - 1, Math.max(0, Math.round(y * scaleY))), fileId }) }} onSave={() => saveProjectToHistory(uploadedFile, 'terrain')} canSave={Boolean(profile)} />}{activeTab === 'flythrough' && <FlythroughPanel fileId={fileId} depthResult={depthResult} terrainData={terrainData} onTerrainLoaded={completeTerrain} onExit={() => setActiveTab('terrain')} />}{activeTab === 'query' && <QueryPanel fileId={fileId} uploadedFile={uploadedFile} initialPoint={analyticsData} />}{activeTab === 'object' && <ObjectViewer fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} objectData={objectData} mode={reconstructionMode} inputViews={inputViews} onObjectLoaded={completeObject} onSave={() => saveProjectToHistory(uploadedFile, reconstructionMode, { characterStyle })} canSave={Boolean(profile)} />}{activeTab === 'text' && <TextTo3DPanel onSaveProject={saveTypographyToHistory} canSave={Boolean(profile)} />}{activeTab === 'analytics' && <AnalyticsPanel fileId={fileId} uploadedFile={uploadedFile} depthResult={depthResult} initialPoint={analyticsData} objectData={objectData} terrainData={terrainData} inputAnalysis={inputAnalysis} history={history} reconstructionMode={reconstructionMode} inputType={inputType} inputViewCount={Object.keys(inputViews).length || 1} onSave={() => saveProjectToHistory(uploadedFile, reconstructionMode, { characterStyle })} canSave={Boolean(profile)} />}</main>
    </div>
    <AuthDialog open={showAuth} onClose={() => setShowAuth(false)} onSave={saveProfile} /><AppearanceDialog open={showAppearance} theme={theme} onSelect={setTheme} onClose={() => setShowAppearance(false)} />
    {showHistory && <div className="modal-backdrop" onMouseDown={() => setShowHistory(false)}><section className="auth-dialog history-dialog" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHistory(false)} aria-label="Close history">×</button><p className="eyebrow">SAVED PROJECT HISTORY</p><h3>Saved projects</h3>{history.length ? <div className="history-list">{history.map(item => <div className="history-item" key={item.id}><div><strong>{item.text || item.filename}</strong><span>{modeLabel(item.type)} · {item.status || 'Saved'} · {new Date(item.createdAt).toLocaleString()}</span></div><aside><button onClick={() => openHistoryItem(item)}>View</button><button onClick={() => renameHistory(item.id)}>Rename</button><button className="danger" onClick={() => deleteHistory(item.id)}>Delete</button></aside></div>)}</div> : <p className="dialog-copy">Save a generated model or project to add it here. Uploading or only viewing a result never saves it automatically.</p>}</section></div>}
  </div>
}
