import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  Expand,
  Flame,
  Image,
  Layers3,
  LoaderCircle,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

const initialPrompt =
  "A tiny cabin nestled in the mountains, wildflowers in the foreground, golden hour light, cinematic and dreamy";

type Creation = {
  title: string;
  image: string;
  prompt: string;
  time: string;
  generated?: boolean;
};

const initialCreations: Creation[] = [
  {
    title: "Where the wild things grow",
    image:
      "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1400&q=85",
    prompt: "A tiny cabin nestled in the mountains, wildflowers in the foreground, golden hour light",
    time: "Just now",
  },
  {
    title: "A softer kind of morning",
    image:
      "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=900&q=85",
    prompt: "A hazy field at sunrise, soft warm light, nostalgic film photography",
    time: "2 hours ago",
  },
  {
    title: "Somewhere, slowly",
    image:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=85",
    prompt: "A lone traveler on a winding road through a mountain valley",
    time: "Yesterday",
  },
  {
    title: "The quiet between",
    image:
      "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=900&q=85",
    prompt: "A dreamy ocean shore with pastel skies and gentle waves",
    time: "Yesterday",
  },
];

const styles = ["Dreamy", "Cinematic", "Analog film", "Watercolor"];

function App() {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [activeStyle, setActiveStyle] = useState("Dreamy");
  const [ratio, setRatio] = useState("3:2");
  const [creations, setCreations] = useState(initialCreations);
  const [activeImage, setActiveImage] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeNav, setActiveNav] = useState("Create");
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const selectedCreation = creations[activeImage % creations.length];

  async function generateImage() {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setNotice("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style: activeStyle, ratio }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Image generation failed. Please try again.");
      }

      const title = prompt.trim().split(/[.!?]/, 1)[0].slice(0, 42) || "Your new creation";
      setCreations((current) => [
        { title, image: result.imageUrl, prompt, time: "Just now", generated: true },
        ...current,
      ]);
      setActiveImage(0);
      setNotice("Your FLUX image is ready");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Image generation failed. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  function selectNavigation(item: string) {
    setActiveNav(item);
    setMobileMenuOpen(false);
    if (item !== "Create") setNotice(`${item} is coming soon`);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={() => selectNavigation("Create")}>
          <span className="brand-mark"><Sparkles size={19} strokeWidth={2.2} /></span>
          <span>dreamsnap<span className="brand-ai">.ai</span></span>
        </a>

        <button className="workspace-picker" onClick={() => setNotice("You’re in your Personal studio")}>
          <span className="workspace-avatar">P</span>
          <span className="workspace-copy"><strong>Priya’s studio</strong><small>Free plan</small></span>
          <ChevronDown size={15} />
        </button>

        <div className="nav-section-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={`nav-item ${activeNav === "Create" ? "active" : ""}`} onClick={() => selectNavigation("Create")}>
            <WandSparkles size={18} /><span>Create</span><span className="nav-shortcut">⌘ K</span>
          </button>
          <button className={`nav-item ${activeNav === "Explore" ? "active" : ""}`} onClick={() => selectNavigation("Explore")}>
            <Compass size={18} /><span>Explore</span>
          </button>
          <button className={`nav-item ${activeNav === "My creations" ? "active" : ""}`} onClick={() => selectNavigation("My creations")}>
            <Image size={18} /><span>My creations</span><span className="nav-count">24</span>
          </button>
          <button className={`nav-item ${activeNav === "My models" ? "active" : ""}`} onClick={() => selectNavigation("My models")}>
            <Layers3 size={18} /><span>My models</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon"><Flame size={15} /></div>
            <strong>A little more magic?</strong>
            <p>Get more generations and train your own models.</p>
            <button onClick={() => setNotice("Plan options are coming soon")}>Explore plans <ArrowRight size={14} /></button>
            <div className="upgrade-orb orb-one" /><div className="upgrade-orb orb-two" />
          </div>
          <button className="nav-item support-link" onClick={() => setNotice("Help center is coming soon")}><CircleHelp size={18} /><span>Help center</span><MessageCircle size={15} className="support-message" /></button>
          <button className="profile-button" onClick={() => setNotice("Account settings are coming soon")}>
            <span className="profile-avatar">P</span><span className="profile-name">Priya Sharma<small>Personal account</small></span><MoreHorizontal size={19} />
          </button>
        </div>
      </aside>

      {mobileMenuOpen && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu-button icon-button" aria-label="Open menu" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <span className="credits-pill"><span className="credits-dot" /> 42 <span>credits left</span></span>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up")}><Bell size={18} /><i /></button>
            <button className="topbar-avatar" aria-label="Open profile">P</button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-sparkle"><Sparkles size={12} /></span> YOUR CREATIVE SPACE</div>
              <h1>Make a little <span>magic.</span></h1>
              <p className="welcome-subtitle">A picture is worth a thousand daydreams. Start with one.</p>
            </div>
            <button className="history-button" onClick={() => setNotice("Your recent generations are shown below")}><Clock3 size={15} /> History</button>
          </section>

          <section className="studio-grid" aria-label="Image generation studio">
            <div className="prompt-panel">
              <div className="panel-heading">
                <div><span className="heading-icon"><WandSparkles size={16} /></span><h2>Your prompt</h2></div>
                <button className="subtle-icon-button" aria-label="Prompt settings" onClick={() => setNotice("Prompt settings are ready")}><Settings2 size={17} /></button>
              </div>
              <label className="sr-only" htmlFor="prompt">Describe the image you want to create</label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the image you have in mind..."
                maxLength={500}
              />
              <div className="prompt-foot"><span>Be as specific as you like</span><span>{prompt.length} / 500</span></div>

              <div className="form-divider" />
              <div className="field-label">STYLE <span>Pick a feeling</span></div>
              <div className="style-options">
                {styles.map((style) => <button key={style} className={`style-chip ${activeStyle === style ? "selected" : ""}`} onClick={() => setActiveStyle(style)}>{style === "Dreamy" && <Sparkles size={13} />}{style}</button>)}
              </div>

              <div className="field-row">
                <div className="field-group">
                  <div className="field-label">ASPECT RATIO</div>
                  <div className="ratio-options">
                    {["1:1", "3:2", "2:3"].map((item) => <button key={item} className={`ratio-button ${ratio === item ? "selected" : ""}`} onClick={() => setRatio(item)}><span className={`ratio-shape ratio-${item.replace(":", "-")}`} />{item}</button>)}
                  </div>
                </div>
                <div className="field-group model-group">
                  <div className="field-label">MODEL</div>
                  <button className="model-select" onClick={() => setShowModelMenu((open) => !open)}><span className="model-flux">✳</span><span>FLUX.1 <small>Community</small></span><ChevronDown size={15} /></button>
                  {showModelMenu && <div className="model-dropdown"><button onClick={() => { setShowModelMenu(false); setNotice("Free FLUX generation runs on community-shared GPUs and may take a few minutes"); }}>✳ FLUX.1 Schnell <span>Free community workers</span></button><button onClick={() => { setShowModelMenu(false); setNotice("DreamSnap custom models are coming soon"); }}>✧ My models <span>Train your own</span></button></div>}
                </div>
              </div>

              <button className="generate-button" disabled={!prompt.trim() || isGenerating} onClick={generateImage}>
                {isGenerating ? <><LoaderCircle className="spin" size={17} /> Dreaming up your image…</> : <><Sparkles size={17} /> Generate image <span>1 credit</span></>}
              </button>
              <p className="generation-note"><span className="sparkle-tiny">✦</span> Free community GPUs; generation can take a few minutes</p>
            </div>

            <div className="preview-panel">
              <div className="preview-topline">
                <div><span className="live-dot" /> <span>{isGenerating ? "CREATING YOUR IMAGE" : "YOUR CANVAS"}</span></div>
                <button className="subtle-icon-button" aria-label="More options" onClick={() => setNotice("More canvas options are coming soon")}><MoreHorizontal size={19} /></button>
              </div>
              <div className={`image-canvas ${isGenerating ? "canvas-loading" : ""}`}>
                <img key={selectedCreation.image} src={selectedCreation.image} alt={selectedCreation.title} />
                {isGenerating && <div className="loading-overlay"><span className="loading-sparkle"><Sparkles size={24} /></span><strong>Dreaming it up</strong><span>Mixing a little magic into your image…</span><div className="loading-track"><i /></div></div>}
                {!isGenerating && <div className="image-overlay-top"><span className="image-tag"><Sparkles size={12} /> {selectedCreation.generated ? "Generated with FLUX" : "Studio preview"}</span><button aria-label="Expand image" onClick={() => setNotice("Full-screen preview is coming soon")}><Expand size={16} /></button></div>}
                {!isGenerating && <div className="image-caption"><div><span>YOUR LATEST CREATION</span><h3>{selectedCreation.title}</h3></div><button className="download-button" aria-label="Download image" onClick={() => setNotice("Image download is coming soon")}><ArrowDownToLine size={17} /></button></div>}
              </div>
              <div className="preview-footer">
                <span><span className="mini-avatar">P</span> Made by you <span className="footer-dot">·</span> {selectedCreation.time}</span>
                <div className="image-pagination"><button aria-label="Previous image" onClick={() => setActiveImage((index) => (index + creations.length - 1) % creations.length)}><ChevronLeft size={16} /></button><span>{activeImage + 1} <i>/</i> {creations.length}</span><button aria-label="Next image" onClick={() => setActiveImage((index) => (index + 1) % creations.length)}><ChevronRight size={16} /></button></div>
              </div>
            </div>
          </section>

          <section className="recent-section">
            <div className="recent-heading">
              <div><h2>A few recent daydreams</h2><p>Little things you brought to life</p></div>
              <button className="view-all-button" onClick={() => selectNavigation("My creations")}>View all <ArrowRight size={15} /></button>
            </div>
            <div className="creation-grid">
              {creations.slice(1, 4).map((creation, index) => (
                <button className={`creation-card ${activeImage === index + 1 ? "creation-active" : ""}`} key={creation.title} onClick={() => setActiveImage(index + 1)}>
                  <div className="creation-image"><img src={creation.image} alt="" /><span className="creation-hover"><Expand size={16} /></span></div>
                  <div className="creation-info"><span>{creation.title}</span><small>{index === 0 ? "2 hours ago" : "Yesterday"}</small></div>
                </button>
              ))}
              <button className="new-creation-card" onClick={() => { setPrompt(""); document.getElementById("prompt")?.focus(); }}>
                <span className="new-creation-icon"><Plus size={19} /></span><strong>Start a new idea</strong><span>There’s more where that came from</span>
              </button>
            </div>
          </section>
          <footer className="page-footer"><span>Made for the pictures in your head <span>✦</span></span><button onClick={() => setNotice("Your feedback helps us make better magic")}>Send feedback <ArrowRight size={13} /></button></footer>
        </div>
      </main>
      {notice && <div className="toast"><span className="toast-check"><Sparkles size={13} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}
    </div>
  );
}

export default App;
