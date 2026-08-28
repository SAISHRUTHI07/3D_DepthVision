import { ArrowRight, Box, Image, Map, ScanFace, Type, Waves } from 'lucide-react'

const EXPERIENCES = [
  { key: 'object', title: '3D Object', icon: Box, visual: '◈', input: 'Single or multi-view image', copy: 'Reconstruct a product, building, or physical object into an explorable visible-surface mesh.' },
  { key: 'terrain', title: '3D Terrain', icon: Map, visual: '⌁', input: 'Aerial, satellite, drone, or map', copy: 'Turn geographic imagery into an elevation surface with terrain controls and flythrough.' },
  { key: 'character', title: '3D Character', icon: ScanFace, visual: '◉', input: 'Portrait or full-body image', copy: 'Prepare a human image for stylized 3D character reconstruction with clear confidence guidance.' },
  { key: 'scene', title: '3D Image / Scene', icon: Image, visual: '▧', input: 'General image or multi-view set', copy: 'Create a depth-based spatial scene from an image without assuming a fixed camera viewpoint.' },
  { key: 'text', title: 'Text / Alphabet to 3D', icon: Type, visual: '3D', input: 'Words, letters, numbers, symbols', copy: 'Build editable local Three.js typography geometry and export it as a real GLB.' },
]

export default function HomeDashboard({ onChoose }) {
  return <div className="home-dashboard">
    <section className="home-hero">
      <div className="hero-grid" aria-hidden="true" /><div className="hero-orbit orbit-one" aria-hidden="true" /><div className="hero-orbit orbit-two" aria-hidden="true" />
      <div className="home-hero-copy"><p className="eyebrow"><Waves size={14} /> UNIFIED 2D → 3D AI RECONSTRUCTION</p><h2>See depth.<br /><em>Explore dimension.</em></h2><p>3D DepthVision turns images, maps, people, scenes, and typography into interactive 3D experiences—without hiding the limits of a single view.</p><div className="home-flow"><span>UPLOAD / ENTER</span><i /> <span>CHOOSE 3D TYPE</span><i /> <span>GENERATE</span><i /> <span>EXPLORE</span></div></div>
      <div className="hero-object" aria-hidden="true"><div className="hero-object-face">3D</div><div className="hero-object-shadow" /></div>
    </section>
    <section className="experience-section"><div className="section-heading"><div><p className="eyebrow">START A WORKFLOW</p><h3>Choose your 3D experience</h3></div><p>Each experience has a dedicated input flow and keeps the underlying terrain and reconstruction pipelines distinct.</p></div><div className="experience-grid">{EXPERIENCES.map(({ key, title, icon: Icon, visual, input, copy }) => <button className={`experience-card ${key}`} key={key} onClick={() => onChoose(key)}><span className="experience-visual" aria-hidden="true">{visual}</span><span className="experience-icon"><Icon size={19} /></span><span className="experience-content"><strong>{title}</strong><small>{copy}</small><em>{input}</em></span><span className="experience-open">Open <ArrowRight size={15} /></span></button>)}</div></section>
  </div>
}
