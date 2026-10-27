import { useEffect, useRef, useState, type ReactNode } from "react";
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

type AuthContext = {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
  isLoaded: boolean;
};

type UserJob = {
  id: string;
  kind: string;
  status: string;
  prompt: string | null;
  error: string | null;
  images: string[];
};

type UserModel = {
  id: string;
  name: string;
  status: string;
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

function App({ auth, accountControl }: { auth: AuthContext | null; accountControl?: ReactNode }) {
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [trainDialogOpen, setTrainDialogOpen] = useState(false);
  const [trainingName, setTrainingName] = useState("");
  const [trainingFiles, setTrainingFiles] = useState<File[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [models, setModels] = useState<UserModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [packCount, setPackCount] = useState(4);
  const handledJobs = useRef(new Set<string>());

  const selectedCreation = creations[activeImage % creations.length];

  async function apiRequest(path: string, init: RequestInit = {}) {
    if (!auth?.isSignedIn) throw new Error("Sign in with Clerk to use your DreamSnap workspace.");
    const token = await auth.getToken();
    if (!token) throw new Error("Your sign-in session expired. Please sign in again.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(path, { ...init, headers });
  }

  useEffect(() => {
    if (!auth?.isSignedIn) return;
    let active = true;
    const poll = async () => {
      try {
        const [jobsResponse, modelsResponse] = await Promise.all([
          apiRequest("/api/jobs"),
          apiRequest("/api/models"),
        ]);
        if (!jobsResponse.ok || !modelsResponse.ok) return;
        const [jobsResult, modelsResult] = await Promise.all([jobsResponse.json(), modelsResponse.json()]);
        if (!active) return;
        const jobs = jobsResult.jobs as UserJob[];
        setModels(modelsResult.models as UserModel[]);
        if (activeJobId) {
          const currentJob = jobs.find((job) => job.id === activeJobId);
          if (currentJob?.status === "COMPLETED" && !handledJobs.current.has(currentJob.id)) {
            handledJobs.current.add(currentJob.id);
            const completedCreations = currentJob.images.map((image, index) => ({
              title: currentJob.kind === "PACK" ? `Your new creation ${index + 1}` : currentJob.prompt?.split(/[.!?]/, 1)[0].slice(0, 42) || "Your new creation",
              image,
              prompt: currentJob.prompt || "",
              time: "Just now",
              generated: true,
            }));
            setCreations((current) => [...completedCreations, ...current]);
            setActiveImage(0);
            setActiveJobId(null);
            setIsGenerating(false);
            setNotice(currentJob.kind === "PACK" ? "Your image pack is ready" : "Your image is ready");
          } else if (currentJob?.status === "FAILED") {
            handledJobs.current.add(currentJob.id);
            setActiveJobId(null);
            setIsGenerating(false);
            setNotice(currentJob.error || "The worker could not finish this job.");
          }
        }
      } catch {
        if (active) setNotice("Could not refresh your jobs. Check your connection and sign-in.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [auth, activeJobId]);

  async function enqueueGeneration(isPack = false) {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setNotice("");
    try {
      const response = await apiRequest(isPack ? "/api/pack/generate" : "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          style: activeStyle,
          ratio,
          ...(selectedModelId ? { modelId: selectedModelId } : {}),
          ...(isPack ? { count: packCount } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Could not queue image generation.");
      }
      setActiveJobId(result.job.id as string);
      setNotice("Job queued. Your Colab worker will pick it up.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Image generation failed. Please try again.");
      setIsGenerating(false);
    }
  }

  async function trainModel() {
    if (isTraining) return;
    if (trainingFiles.length < 3 || trainingFiles.length > 20) {
      setNotice("Choose between 3 and 20 training images.");
      return;
    }
    setIsTraining(true);
    try {
      const imageKeys: string[] = [];
      for (const file of trainingFiles) {
        const presignResponse = await apiRequest("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, size: file.size }),
        });
        const upload = await presignResponse.json();
        if (!presignResponse.ok) throw new Error(upload.error || "Could not prepare an image upload.");
        const putResponse = await fetch(upload.uploadUrl as string, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putResponse.ok) throw new Error(`Could not upload ${file.name}. Check the S3 bucket CORS settings.`);
        imageKeys.push(upload.key as string);
      }
      const response = await apiRequest("/api/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trainingName, imageKeys }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not queue model training.");
      setTrainDialogOpen(false);
      setTrainingFiles([]);
      setTrainingName("");
      setNotice("Model training queued. The training worker will pick it up.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not queue model training.");
    } finally {
      setIsTraining(false);
    }
  }

  function selectNavigation(item: string) {
    setActiveNav(item);
    setMobileMenuOpen(false);
    if (item === "My models") {
      setTrainDialogOpen(true);
      return;
    }
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
            <span className="credits-pill"><span className="credits-dot" /> Colab <span>GPU workers</span></span>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setNotice("You’re all caught up")}><Bell size={18} /><i /></button>
            {accountControl || <button className="topbar-avatar" aria-label="Authentication setup required" onClick={() => setNotice("Configure Clerk keys in .env to sign in.")}>P</button>}
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-sparkle"><Sparkles size={12} /></span> YOUR CREATIVE SPACE</div>
              <h1>Make a little <span>magic.</span></h1>
              <p className="welcome-subtitle">A picture is worth a thousand daydreams. Start with one.</p>
            </div>
            <div className="welcome-actions">
              <button className="train-model-button" onClick={() => setTrainDialogOpen(true)}><Layers3 size={15} /> Train a model</button>
              <button className="history-button" onClick={() => setNotice("Your recent generations are shown below")}><Clock3 size={15} /> History</button>
            </div>
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
                  <button className="model-select" onClick={() => setShowModelMenu((open) => !open)}><span className="model-flux">✳</span><span>{selectedModelId ? models.find((model) => model.id === selectedModelId)?.name || "Your model" : "FLUX.1 Schnell"}</span><ChevronDown size={15} /></button>
                  {showModelMenu && <div className="model-dropdown">
                    <button onClick={() => { setSelectedModelId(""); setShowModelMenu(false); }}>✳ FLUX.1 Schnell <span>Base model</span></button>
                    {models.filter((model) => model.status === "COMPLETED").map((model) => <button key={model.id} onClick={() => { setSelectedModelId(model.id); setShowModelMenu(false); }}>{model.name} <span>Your trained LoRA</span></button>)}
                    <button onClick={() => { setShowModelMenu(false); setTrainDialogOpen(true); }}>＋ Train a custom model <span>Upload training images</span></button>
                  </div>}
                </div>
              </div>

              <div className="generate-actions">
                <button className="generate-button" disabled={!prompt.trim() || isGenerating} onClick={() => void enqueueGeneration()}>
                  {isGenerating ? <><LoaderCircle className="spin" size={17} /> Waiting for your worker…</> : <><Sparkles size={17} /> Generate image</>}
                </button>
                <label className="pack-count-label">PACK
                  <select value={packCount} onChange={(event) => setPackCount(Number(event.target.value))} aria-label="Pack size">
                    {[2, 4, 6, 8, 10].map((count) => <option key={count} value={count}>{count}</option>)}
                  </select>
                </label>
                <button className="pack-button" disabled={!prompt.trim() || isGenerating} onClick={() => void enqueueGeneration(true)}>Create pack</button>
              </div>
              <p className="generation-note"><span className="sparkle-tiny">✦</span> Jobs wait in PostgreSQL until your Colab worker is online</p>
            </div>

            <div className="preview-panel">
              <div className="preview-topline">
                <div><span className="live-dot" /> <span>{isGenerating ? "WAITING FOR WORKER" : "YOUR CANVAS"}</span></div>
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
      {trainDialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isTraining) setTrainDialogOpen(false); }}>
        <section className="training-dialog" role="dialog" aria-modal="true" aria-labelledby="training-title">
          <div className="dialog-heading"><div><span className="heading-icon"><Layers3 size={16} /></span><h2 id="training-title">Train your model</h2></div><button className="subtle-icon-button" aria-label="Close dialog" disabled={isTraining} onClick={() => setTrainDialogOpen(false)}><X size={17} /></button></div>
          <p>Upload 3–20 clear photos. Your Colab training worker will create a personal FLUX LoRA.</p>
          <label className="training-field-label" htmlFor="model-name">MODEL NAME</label>
          <input id="model-name" className="training-name-input" value={trainingName} onChange={(event) => setTrainingName(event.target.value)} maxLength={60} placeholder="e.g. My portrait style" />
          <label className="training-upload" htmlFor="training-images"><Plus size={19} /><strong>Select training photos</strong><span>JPEG, PNG, or WebP · up to 15 MB each</span><small>{trainingFiles.length} / 20 selected</small></label>
          <input id="training-images" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setTrainingFiles(Array.from(event.target.files || []).slice(0, 20))} />
          {models.length > 0 && <div className="model-status-list"><strong>Your models</strong>{models.slice(0, 5).map((model) => <span key={model.id}>{model.name}<small>{model.status}</small></span>)}</div>}
          <button className="generate-button" disabled={isTraining || trainingFiles.length < 3 || !trainingName.trim()} onClick={() => void trainModel()}>{isTraining ? <><LoaderCircle className="spin" size={16} /> Uploading and queueing…</> : <><Layers3 size={16} /> Queue model training</>}</button>
          <small className="training-disclaimer">Training uses your configured worker GPU. Uploaded photos are stored in your private S3 bucket.</small>
        </section>
      </div>}
      {notice && <div className="toast"><span className="toast-check"><Sparkles size={13} /></span>{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div>}
    </div>
  );
}

export default App;
