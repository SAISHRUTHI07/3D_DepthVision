import { Check, Palette } from 'lucide-react'

const THEMES = [
  { id: 'midnight', name: 'Midnight Blue', group: 'Dark', note: 'Focused deep-navy workspace' },
  { id: 'space', name: 'Deep Space', group: 'Dark', note: 'Near-black with cool stars' },
  { id: 'violet', name: 'Blue Violet', group: 'Dark', note: 'Subtle indigo studio light' },
  { id: 'graphite', name: 'Graphite', group: 'Dark', note: 'Neutral production surface' },
  { id: 'aurora', name: 'Aurora', group: 'Dark', note: 'Restrained cyan-violet glow' },
  { id: 'white', name: 'Clean White', group: 'Light', note: 'Crisp high-contrast daylight' },
  { id: 'soft-blue', name: 'Soft Blue', group: 'Light', note: 'Calm blue-grey workspace' },
  { id: 'pearl', name: 'Pearl', group: 'Light', note: 'Warm neutral paper surface' },
  { id: 'light-violet', name: 'Light Violet', group: 'Light', note: 'Pale modern lavender' },
  { id: 'sunset', name: 'Sunset Ember', group: 'Dark', note: 'Warm plum and coral glow' },
  { id: 'forest', name: 'Forest Canopy', group: 'Dark', note: 'Deep green with mint accents' },
  { id: 'ocean', name: 'Ocean Depths', group: 'Dark', note: 'Ink blue with electric cyan' },
  { id: 'rose', name: 'Rose Quartz', group: 'Light', note: 'Soft blush with berry accents' },
  { id: 'sand', name: 'Sandstone', group: 'Light', note: 'Earthy sand and terracotta tones' },
]

export default function AppearanceDialog({ open, theme, onSelect, onClose }) {
  if (!open) return null
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="auth-dialog appearance-dialog" onMouseDown={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Close appearance">×</button>
      <Palette className="auth-icon" size={26} /><p className="eyebrow">APPEARANCE</p><h3>Workspace background</h3>
      <p className="dialog-copy">Choose a restrained theme for this browser. Your choice persists after refresh.</p>
      <div className="theme-grid">{THEMES.map(option => <button key={option.id} className={`theme-card theme-preview-${option.id} ${theme === option.id ? 'selected' : ''}`} onClick={() => onSelect(option.id)}><span className="theme-swatch" /><span><strong>{option.name}</strong><small>{option.group} · {option.note}</small></span>{theme === option.id && <Check size={17} />}</button>)}</div>
    </section>
  </div>
}
