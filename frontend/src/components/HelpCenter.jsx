import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BarChart3, ChevronDown, Compass, FileImage, HelpCircle, Mountain, Search, Sparkles, Waves, X } from 'lucide-react'

const categories = [
  { icon: Sparkles, title: 'Getting started', items: ['What is 3D DepthVision?', 'How does 3D DepthVision work?', 'How do I upload an image?', 'What happens after uploading an image?', 'How do I generate a 3D terrain?'] },
  { icon: Compass, title: 'Using 3D DepthVision', items: ['Uploading a 2D image', 'Starting depth analysis', 'Generating the 3D terrain', 'Navigating the 3D viewer', 'Rotating, zooming and panning', 'Using the 3D flythrough'] },
  { icon: FileImage, title: 'Image requirements', items: ['JPG and PNG images are supported.', 'Use a clear, high-quality image with visible terrain.', 'Avoid very dark, blurred, or heavily compressed images.', 'Aerial, satellite, map, and drone terrain images work best.'] },
  { icon: BarChart3, title: 'Understanding results', items: ['Depth Map: relative depth estimated from the image.', 'Height Estimation: AI-based elevation estimates.', '3D Terrain: a mesh generated from depth values.', 'Terrain Analytics and Flythrough: tools to inspect the result.'] },
  { icon: AlertTriangle, title: 'Troubleshooting', items: ['Image will not upload', '3D terrain is not generating', 'Processing is taking too long', 'Terrain looks inaccurate', '3D viewer or flythrough is not loading'] },
  { icon: HelpCircle, title: 'Frequently asked questions', items: ['Can I generate terrain from a single 2D image?', 'What type of images work best?', 'Is estimated height accurate?', 'Can I download the generated result?'] },
]

const faqs = [
  ['What is 3D DepthVision?', '3D DepthVision turns a single image into an estimated depth map and an interactive 3D terrain model.'],
  ['Can I generate a 3D terrain from a single 2D image?', 'Yes. The AI estimates relative depth from one image, then uses those values to shape the terrain mesh.'],
  ['What type of images work best?', 'Clear aerial, satellite, map, and drone images with visible terrain features generally produce the most useful results.'],
  ['Is the estimated height accurate?', 'It is an AI-based estimate, useful for visualization and exploration. It is not a substitute for professional surveying equipment.'],
  ['How long does processing take?', 'Most images finish in moments, though very large images or a busy compute environment may take longer.'],
  ['Why does my generated terrain look different from the original image?', 'A 3D result is inferred from visual cues in a 2D image. Blur, shadows, low contrast, and an unusual viewpoint can affect the estimate.'],
  ['Can I use the generated terrain for professional surveying?', 'No. Validate against calibrated or surveyed elevation data before using it for engineering, legal, or safety-critical work.'],
  ['Can I download the generated result?', 'Use the available export/download controls in the terrain viewer when a generated model is ready.'],
]

const fixes = [
  ['Image will not upload', 'Use a JPG or PNG image, check that it is not corrupted, and keep it within the upload size limit.'],
  ['Unsupported image format', 'Convert the image to JPG or PNG, then upload it again.'],
  ['3D terrain is not generating', 'Run Depth Analysis first and wait for it to finish before opening the 3D Terrain viewer.'],
  ['Processing is taking too long', 'Try a smaller source image and keep this tab open until the process completes.'],
  ['Terrain looks inaccurate', 'Use a clearer terrain image with stronger visible elevation cues and fewer shadows or obstructions.'],
  ['3D viewer or flythrough is not loading', 'Refresh the page, ensure depth analysis completed, and try again with a smaller image if memory is limited.'],
  ['Download or export is not working', 'Generate the terrain fully before exporting; then retry from the terrain viewer controls.'],
]

const guide = [['Upload image', 'Choose a clear aerial, satellite, map, or drone image.'], ['AI depth analysis', 'The AI creates a full-image relative depth estimate.'], ['Height estimation', 'Depth values are normalized into an elevation field.'], ['3D terrain reconstruction', 'The elevation field becomes a smooth terrain mesh.'], ['Interactive flythrough', 'Rotate, zoom, pan, measure, and inspect the result.']]

export default function HelpCenter({ onContact }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(null)
  const normalized = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!normalized) return []
    return [...categories.flatMap(category => category.items.map(item => ({ heading: category.title, item }))), ...faqs.map(([item]) => ({ heading: 'Frequently asked questions', item })), ...fixes.map(([item]) => ({ heading: 'Troubleshooting', item }))].filter(result => `${result.heading} ${result.item}`.toLowerCase().includes(normalized))
  }, [normalized])

  return <section className="help-center">
    <header className="help-hero">
      <p className="eyebrow">HELP CENTER</p>
      <h2>How can we help you?</h2>
      <p>Find everything you need to get started with 3D DepthVision, generate 3D terrain, understand your results, and troubleshoot common issues.</p>
      <label className="help-search"><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search for help..." aria-label="Search help topics" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={17} /></button>}</label>
      {normalized && <div className="search-results" aria-live="polite">{results.length ? results.map((result, index) => <button key={`${result.item}-${index}`} onClick={() => setQuery(result.item)}><small>{result.heading}</small>{result.item}<ArrowRight size={14} /></button>) : <p>No results found. Try another search term or contact our team.</p>}</div>}
    </header>

    <section><div className="help-section-heading"><p className="eyebrow">EXPLORE TOPICS</p><h3>Everything you need, in one place</h3></div><div className="help-category-grid">{categories.map(({ icon: Icon, title, items }) => <article className="help-category" key={title}><span><Icon size={21} /></span><h4>{title}</h4><ul>{items.slice(0, 4).map(item => <li key={item}>{item}</li>)}</ul></article>)}</div></section>

    <section className="help-guide"><div className="help-section-heading"><p className="eyebrow">QUICK GUIDE</p><h3>How it works</h3></div><div className="help-guide-steps">{guide.map(([title, copy], index) => <article key={title}><b>0{index + 1}</b><div><h4>{title}</h4><p>{copy}</p></div>{index < guide.length - 1 && <ArrowRight className="guide-arrow" size={18} />}</article>)}</div></section>

    <section className="help-two-column"><article className="help-results-card"><div className="help-section-heading"><p className="eyebrow">RESULTS</p><h3>Understanding your terrain</h3></div><p><strong>Depth Map</strong>, height estimation, 3D terrain, visualization, flythrough, and analytics help you inspect the generated scene.</p><p className="help-notice"><Mountain size={17} /> Height and depth values are AI-based estimates, not a replacement for professional surveying equipment.</p></article><article className="help-tips"><div className="help-section-heading"><p className="eyebrow">BETTER RESULTS</p><h3>Quick tips</h3></div><ul><li>Use clear, high-quality images.</li><li>Prefer visible terrain features.</li><li>Avoid extremely dark or blurred images.</li><li>Keep the terrain clearly visible.</li><li>Use suitable camera angles when possible.</li><li>Remember: AI height is an estimate.</li></ul></article></section>

    <section className="help-accordion-section"><div className="help-section-heading"><p className="eyebrow">TROUBLESHOOTING</p><h3>Fix common issues</h3></div>{fixes.map(([title, copy], index) => <Accordion key={title} title={title} copy={copy} open={open === `fix-${index}`} onClick={() => setOpen(open === `fix-${index}` ? null : `fix-${index}`)} />)}</section>
    <section className="help-accordion-section"><div className="help-section-heading"><p className="eyebrow">FAQ</p><h3>Frequently asked questions</h3></div>{faqs.map(([title, copy], index) => <Accordion key={title} title={title} copy={copy} open={open === `faq-${index}`} onClick={() => setOpen(open === `faq-${index}` ? null : `faq-${index}`)} />)}</section>

    <section className="help-cta"><Waves size={32} /><div><p className="eyebrow">WE'RE HERE TO HELP</p><h3>Still need help?</h3><p>Can't find what you're looking for? Get in touch with the 3D DepthVision team.</p></div><button className="btn btn-primary" onClick={onContact}>Contact Us <ArrowRight size={16} /></button></section>
  </section>
}

function Accordion({ title, copy, open, onClick }) {
  return <article className={`help-accordion ${open ? 'open' : ''}`}><button onClick={onClick} aria-expanded={open}><span>{title}</span><ChevronDown size={19} /></button>{open && <p>{copy}</p>}</article>
}
