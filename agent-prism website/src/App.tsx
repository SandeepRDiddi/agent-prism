import React, { useState, useEffect, useRef, useTransition } from "react";
import { Engine, World, Bodies, Mouse, MouseConstraint, Body } from "matter-js";
import { 
  Play, 
  RefreshCw, 
  Layers, 
  ShieldAlert, 
  BadgeDollarSign, 
  Cpu, 
  Zap, 
  FileText, 
  ChevronRight, 
  X, 
  Sliders, 
  Terminal as TermIcon,
  HelpCircle
} from "lucide-react";

import { TelemetryLog, ProxySimulationReport } from "./types";
import ProxySimulator from "./components/ProxySimulator";
import MetricCharts from "./components/MetricCharts";
import AgentTerminal from "./components/AgentTerminal";
import ForensicsLab from "./components/ForensicsLab";

export default function App() {
  const [viewMode, setViewMode] = useState<"dashboard" | "sandbox">("dashboard");
  const [activePane, setActivePane] = useState<string | null>(null);
  
  // High-level aggregate metrics that sync with simulations
  const [leaksPrevented, setLeaksPrevented] = useState(4812.20);
  const [successScore, setSuccessScore] = useState(94.8);
  const [latencyAvg, setLatencyAvg] = useState(114);
  const [proxyStatus, setProxyStatus] = useState("PROXY_ACTIVE");

  // Feature Toggles state
  const [killswitchArmed, setKillswitchArmed] = useState(true);
  const [optimizerThreshold, setOptimizerThreshold] = useState(1.50);

  // Live log buffers managed via Ref to avoid triggering react re-renders on animation streams
  const logsRef = useRef<TelemetryLog[]>([]);
  
  const addLog = (message: string, level: TelemetryLog["level"], service: string) => {
    const timestamp = new Date().toLocaleTimeString();
    logsRef.current.push({ timestamp: `[${timestamp}]`, level, message, service });
    if (logsRef.current.length > 100) {
      logsRef.current.shift();
    }
  };

  // Initialize standard starter logs
  useEffect(() => {
    if (logsRef.current.length === 0) {
      addLog("initial proxy connection established safely", "PASS", "prism-proxy-node");
      addLog("validating multi-agent gateway rules in cluster", "PASS", "prism-proxy-node");
      addLog("Heuristics parser registered zero routing anomalies", "PASS", "sledgehammer-gate");
    }
  }, []);

  // Sync state stats when an interactive stream is intercepted in ProxySimulator
  const handleSimulationRun = (report: ProxySimulationReport) => {
    if (report.intercepted) {
      setLeaksPrevented(prev => parseFloat((prev + report.savedCost).toFixed(2)));
    } else if (report.action === "OPTIMIZER_DOWN_ROUTED") {
      setLeaksPrevented(prev => parseFloat((prev + report.savedCost).toFixed(4)));
    }
    // Dynamic slight variations on latency & success to show real-time live telemetry
    setLatencyAvg(prev => Math.max(50, Math.floor(prev + (Math.random() - 0.5) * 6)));
    setSuccessScore(prev => Math.min(100, parseFloat((prev + (Math.random() - 0.5) * 0.4).toFixed(1))));
  };

  const handleClearLogs = () => {
    logsRef.current = [];
    addLog("Terminal output records cleared by controller node.", "PASS", "prism-proxy-node");
  };

  // --- MATTER.JS INTERACTIVE 2D PHYSICS SANDBOX ARCHITECTURE ---
  const sandboxContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const bodiesRef = useRef<{ body: Body; metadata: typeof BOX_METADATA[0]; el: HTMLDivElement }[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const [zeroGravity, setZeroGravity] = useState(false);

  const BOX_METADATA = [
    { id: "box-hero", x: 280, y: 150, w: 460, h: 220 },
    { id: "box-leak", x: 620, y: 110, w: 230, h: 100 },
    { id: "box-threads", x: 620, y: 220, w: 230, h: 100 },
    { id: "box-terminal", x: 290, y: 390, w: 480, h: 200 },
    { id: "box-feat1", x: 180, y: 520, w: 280, h: 100 },
    { id: "box-feat2", x: 480, y: 520, w: 280, h: 100 },
    { id: "box-feat3", x: 780, y: 520, w: 280, h: 100 }
  ];

  // Effect to manage Physics Sandbox setup and destruction
  useEffect(() => {
    if (viewMode !== "sandbox") {
      // Cleanup Matter references when switching to dashboard aligned grid
      stopPhysics();
      return;
    }

    // Wait slightly to guarantee DOM elements are properly rendered
    const timeout = setTimeout(() => {
      startPhysics();
    }, 100);

    return () => {
      clearTimeout(timeout);
      stopPhysics();
    };
  }, [viewMode]);

  const startPhysics = () => {
    if (!sandboxContainerRef.current) return;

    const container = sandboxContainerRef.current;
    const cw = container.clientWidth || window.innerWidth;
    const ch = container.clientHeight || 650;

    const engine = Engine.create();
    engine.gravity.y = zeroGravity ? 0 : 1;
    engineRef.current = engine;

    const registeredBodies: typeof bodiesRef.current = [];

    // Create Matter.js rectangles matching physical dimensions
    BOX_METADATA.forEach(cfg => {
      const el = container.querySelector(`#${cfg.id}`) as HTMLDivElement;
      if (!el) return;

      const body = Bodies.rectangle(cfg.x, cfg.y, cfg.w, cfg.h, {
        restitution: 0.2,
        frictionAir: zeroGravity ? 0.05 : 0.03,
        friction: 0.1
      });

      // Maintain initial variables inside the matter body reference
      (body as any).initialX = cfg.x;
      (body as any).initialY = cfg.y;

      registeredBodies.push({ body, metadata: cfg, el });
      World.add(engine.world, body);
    });

    bodiesRef.current = registeredBodies;

    // Create solid physical boundaries on container limits to prevent falling off the edges
    const thickness = 100;
    const ground = Bodies.rectangle(cw / 2, ch + thickness / 2, cw * 3, thickness, { isStatic: true });
    const ceiling = Bodies.rectangle(cw / 2, -thickness / 2, cw * 3, thickness, { isStatic: true });
    const leftWall = Bodies.rectangle(-thickness / 2, ch / 2, thickness, ch * 3, { isStatic: true });
    const rightWall = Bodies.rectangle(cw + thickness / 2, ch / 2, thickness, ch * 3, { isStatic: true });

    World.add(engine.world, [ground, ceiling, leftWall, rightWall]);

    // Setup interactive mouse constraint dragging mechanics inside the preview box
    const mouse = Mouse.create(container);
    const mouseConstraint = MouseConstraint.create(engine, {
      mouse: mouse,
      constraint: {
        stiffness: 0.2,
        render: { visible: false }
      }
    });

    World.add(engine.world, mouseConstraint);

    // Keep mouse constraints synchronized when canvas viewport changes
    mouse.element.removeEventListener("mousewheel", (mouse as any).mousewheel);
    mouse.element.removeEventListener("DOMMouseScroll", (mouse as any).mousewheel);

    // Dynamic RAF render sync loop
    const runLoop = () => {
      Engine.update(engine, 1000 / 60);

      bodiesRef.current.forEach(({ body, metadata, el }) => {
        const { x, y } = body.position;
        // Map matter coordinates directly to high-perf CSS 3D transforms
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.transform = `translate3d(${x - metadata.w / 2}px, ${y - metadata.h / 2}px, 0px) rotate(${body.angle}rad)`;
      });

      animationFrameRef.current = requestAnimationFrame(runLoop);
    };

    animationFrameRef.current = requestAnimationFrame(runLoop);
  };

  const stopPhysics = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (engineRef.current) {
      World.clear(engineRef.current.world, false);
      Engine.clear(engineRef.current);
      engineRef.current = null;
    }

    // Reset inline styles and transforms on elements so normal CSS grid takes over seamlessly!
    bodiesRef.current.forEach(({ el }) => {
      el.style.left = "";
      el.style.top = "";
      el.style.transform = "";
    });

    bodiesRef.current = [];
  };

  const handleToggleZeroGravity = () => {
    const nextVal = !zeroGravity;
    setZeroGravity(nextVal);
    if (engineRef.current) {
      engineRef.current.gravity.y = nextVal ? 0 : 1;
      // Introduce an elegant floating momentum drift push when gravity hits zero!
      if (nextVal) {
        bodiesRef.current.forEach(({ body }) => {
          Body.setVelocity(body, {
            x: (Math.random() - 0.5) * 4,
            y: (Math.random() - 0.5) * 4
          });
        });
      }
    }
  };

  const handleResetAlignment = () => {
    if (viewMode === "sandbox") {
      // Reset position of bodies in physics coordinates
      bodiesRef.current.forEach(({ body, metadata }) => {
        Body.setPosition(body, { x: metadata.x, y: metadata.y });
        Body.setAngle(body, 0);
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
      });
    }
  };

  const [, startTransition] = useTransition();

  const handleViewModeChange = (mode: "dashboard" | "sandbox") => {
    startTransition(() => {
      setViewMode(mode);
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50 text-slate-900 antialiased font-sans">
      {/* HUD HEADER NAVBAR */}
      <header className="sticky top-0 w-full h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-40 select-none">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black flex items-center justify-center transform rotate-45 shrink-0 select-none">
              <div className="w-3 h-3 bg-white"></div>
            </div>
            <span className="font-bold text-xl tracking-tighter text-slate-950 uppercase">Agent Prism</span>
          </div>
          <span className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-1.5 px-2.5 py-1 border border-green-200 bg-green-50 text-green-700 font-mono text-[10px] uppercase tracking-widest font-bold animate-pulse">
            <span className="w-1.5 h-1.5 bg-green-600 rounded-full" />
            <span>
              {proxyStatus === "PROXY_ACTIVE" ? "Proxy active" : proxyStatus}
            </span>
          </div>
        </div>

        {/* CONTROLLER TOGGLES */}
        <div className="flex items-center gap-4">
          {/* Mode Switcher */}
          <div className="bg-slate-50 p-1 rounded-none flex gap-1 border border-slate-200">
            <button
              id="view-mode-dashboard"
              onClick={() => handleViewModeChange("dashboard")}
              className={`text-xs px-4 py-1.5 font-bold uppercase tracking-widest rounded-none transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none ${
                viewMode === "dashboard"
                  ? "bg-black text-white"
                  : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Aligned Grid
            </button>
            <button
              id="view-mode-sandbox"
              onClick={() => handleViewModeChange("sandbox")}
              className={`text-xs px-4 py-1.5 font-bold uppercase tracking-widest rounded-none transition-all flex items-center gap-1.5 cursor-pointer focus:outline-none ${
                viewMode === "sandbox"
                  ? "bg-black text-white"
                  : "text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Physics Sandbox
            </button>
          </div>

          {/* Physics Actions (only active when inside sandbox view) */}
          {viewMode === "sandbox" && (
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4 animate-fadeIn">
              <button
                id="btn-gravity"
                onClick={handleToggleZeroGravity}
                className={`text-xs font-bold uppercase tracking-widest px-4 py-1.5 border rounded-none transition-all cursor-pointer focus:outline-none ${
                  zeroGravity
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "border-slate-300 text-slate-705 bg-white hover:bg-slate-50"
                }`}
              >
                {zeroGravity ? "Engage Gravity" : "Zero-Gravity"}
              </button>
              <button
                id="btn-reset"
                onClick={handleResetAlignment}
                className="border border-slate-300 text-slate-700 px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-none hover:bg-slate-50 transition-all cursor-pointer focus:outline-none"
              >
                Reset Alignment
              </button>
            </div>
          )}
        </div>
      </header>

      {/* DETAILED CONTENT ARENA */}
      <main className="flex-1 relative bg-white">
        
        {/* VIEW 1: DYNAMIC physics sandbox wrapper */}
        {viewMode === "sandbox" ? (
          <div 
            ref={sandboxContainerRef} 
            className="w-full h-[calc(100vh-60px)] relative overflow-hidden bg-slate-50 border-b border-gray-200 select-none cursor-grab active:cursor-grabbing"
          >
            {/* Box items parsed absolutely matching placement instructions */}
            <div id="box-hero" className="physics-box w-[460px] h-[220px]" onClick={() => setActivePane("interactive-sim")}>
              <span className="text-[9px] font-mono text-[#1a0dab] font-bold uppercase tracking-wider block mb-1">
                // MODULE_1: CORE_PROXY_COORDINATOR
              </span>
              <h1 className="text-lg font-bold tracking-tight text-gray-900 leading-tight mb-2">
                The control plane for enterprise AI agents
              </h1>
              <p className="text-xs text-gray-500 leading-relaxed max-w-lg mb-4">
                One dashboard to compare providers, catch runaway loops, and guarantee safety budgets — without modifying your production parameters.
              </p>
              <div className="flex items-center gap-2">
                <button className="bg-black hover:bg-neutral-800 text-white text-[11px] font-medium px-4 py-2 cursor-pointer transition-colors">
                  Open Proxy Sim
                </button>
                <code className="bg-gray-100 border border-gray-200 text-[10px] px-2.5 py-2 text-gray-700 font-mono flex-1 rounded-sm select-all">
                  npm i @prism/proxy
                </code>
              </div>
            </div>

            <div id="box-leak" className="physics-box w-[230px] h-[100px]" onClick={() => setActivePane("terminal-logs")}>
              <div className="text-[10px] font-mono text-gray-400 font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Leaks Prevented</span>
                <BadgeDollarSign className="w-3.5 h-3.5 text-[#ea4335]" />
              </div>
              <div className="text-2xl font-mono font-bold text-[#ea4335] tracking-tight">
                ${leaksPrevented.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </div>
              <p className="text-[10px] text-gray-500 mt-1 leading-normal">
                Recursive loops caught & terminated.
              </p>
            </div>

            <div id="box-threads" className="physics-box w-[230px] h-[100px]" onClick={() => setActivePane("latency-charts")}>
              <div className="text-[10px] font-mono text-gray-400 font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Success Ratio</span>
                <ShieldAlert className="w-3.5 h-3.5 text-green-500" />
              </div>
              <div className="text-2xl font-mono font-bold text-green-600 tracking-tight">
                {successScore}%
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Latency avg: <span className="font-mono text-black font-semibold">{latencyAvg}ms</span>
              </p>
            </div>

            <div id="box-terminal" className="physics-box w-[480px] h-[200px]" onClick={() => setActivePane("terminal-logs")}>
              <div className="flex justify-between items-center border-b border-gray-100 pb-1.5 mb-2 text-[10px] font-mono font-bold text-gray-400">
                <span className="text-[#1a0dab] font-mono">AGENT_PRISM_INBOUND_STREAM</span>
                <span className="animate-pulse text-green-600">● GATEWAY MONITOR</span>
              </div>
              <div className="font-mono text-[10px] text-gray-500 space-y-1 overflow-hidden h-[130px] select-none">
                <div className="text-slate-400 font-bold">// Click elements to inspect and configure proxy details.</div>
                <div className="text-slate-600 font-bold mt-1">Recent trace:</div>
                <div className="text-gray-700 font-semibold">[INBOUND] Intercepted thread dispatch on model cluster...</div>
                <div className="text-[#34a853]">[PASS] gateway approved loop analysis. (82ms)</div>
                <div className="text-gray-400">[METRIC] token usage aggregation updated successfully.</div>
              </div>
            </div>

            <div id="box-feat1" className="physics-box w-[280px] h-[100px]" onClick={() => setActivePane("interactive-sim")}>
              <div className="flex gap-1.5 items-center mb-1">
                <ShieldAlert className="w-4 h-4 text-red-600" />
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-tight">Sledgehammer Switch</h3>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed font-sans">
                Instantly terminates circular recursive model logic traps and runaway exponential loops based on proxy context window pattern matching heuristics.
              </p>
            </div>

            <div id="box-feat2" className="physics-box w-[280px] h-[100px]" onClick={() => setActivePane("latency-charts")}>
              <div className="flex gap-1.5 items-center mb-1">
                <BadgeDollarSign className="w-4 h-4 text-emerald-600" />
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-tight">Provider Interrogator</h3>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed font-sans">
                Arbitrates models transparently on performance margins. Swiftly down-routes expensive prompts to fast lightweight models like Gemini 3.1 Flash.
              </p>
            </div>

            <div id="box-feat3" className="physics-box w-[280px] h-[100px]" onClick={() => setActivePane("forensic-lab")}>
              <div className="flex gap-1.5 items-center mb-1">
                <HelpCircle className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-tight">Autopsy Forensic Lab</h3>
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed font-sans">
                Harness core LLM cognitive diagnostic intelligence to isolate trace vectors and auto-generate corrected prompts with verified loop break boundaries.
              </p>
            </div>
          </div>
        ) : (
          /* VIEW 2: HIGHLY POLISHED ALIGNED BENTO GRID LAYOUT */
          <div className="max-w-7xl mx-auto px-8 py-10 space-y-10 select-none">
            {/* Geometric Balance Dashboard Hero Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-0 border-b border-slate-200 pb-10">
              <div className="md:col-span-12 space-y-4">
                <span className="text-[11px] font-mono text-blue-600 font-bold uppercase tracking-[0.2em] block mb-2">// System Layer 01</span>
                <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-[0.95] text-slate-950 max-w-4xl">
                  The control plane for <span className="text-blue-600 italic font-serif font-extrabold">enterprise</span> AI agents.
                </h1>
                <p className="text-base md:text-lg text-slate-500 max-w-3xl leading-relaxed pt-2">
                  Intercept, audit, and optimize every token. Stop runaway cost leaks and verify model honesty in real-time without changing a line of agent logic.
                </p>
                
                <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-4">
                  <button
                    onClick={() => setActivePane("interactive-sim")}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 font-bold text-xs uppercase tracking-widest rounded-none transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Deploy Interceptor
                  </button>
                  <div className="flex-1 flex items-center justify-between bg-slate-50 border border-slate-200 px-4 py-4 font-mono text-xs text-slate-600 rounded-none">
                    <div className="flex items-center min-w-0">
                      <span className="opacity-30 mr-2 select-none">$</span>
                      <span className="truncate">npm install @prism/proxy</span>
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText("npm install @prism/proxy");
                        addLog("Copied gateway package installation code to clipboard.", "PASS", "prism-proxy-node");
                      }}
                      className="text-[10px] text-blue-600 font-bold tracking-widest uppercase hover:underline ml-3 shrink-0 cursor-pointer"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 pt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                    <span>AWS Region: US-East-1</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                    <span>Provider Mesh: OpenAI / Anthropic / Llama-3</span>
                  </div>
                </div>
              </div>
            </div>

            {/* THREE-COLUMN BENTO GRID */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* PRIMARY GATEWAY INTRO BENTO */}
              <div className="md:col-span-2 border border-slate-200 rounded-none bg-white p-8 space-y-6 flex flex-col justify-between shadow-none">
                <div>
                  <div className="flex items-center gap-1.5 mb-2 select-none">
                    <span className="text-[10px] font-mono text-blue-600 font-bold uppercase tracking-widest block">
                      // PRISM CORE LAYER
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-950 mb-3">
                    The intelligence-led middleware firewall for multi-agent chains
                  </h2>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-xl">
                    Run agent flows with complete cognitive and metric transparency. We sit between your developer application and your LLM endpoint cluster, shielding your organization from expensive recursive loops, runaway thread budget leaks, and system logic locks automatically.
                  </p>
                </div>

                {/* Quick copy tag and indicator stats */}
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="border border-slate-200 bg-slate-50/50 p-4 rounded-none">
                      <div className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider">Latency Benefit</div>
                      <div className="text-xl font-bold text-slate-900 mt-1">-58% average duration</div>
                    </div>
                    <div className="border border-slate-200 bg-slate-50/50 p-4 rounded-none">
                      <div className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider">Arbitrage Savings</div>
                      <div className="text-xl font-bold text-slate-900 mt-1">Up to 84% cost cut</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* DUAL COHESIVE METRIC METRIC SLABS */}
              <div className="space-y-6 flex flex-col justify-between">
                {/* Cost prevented metric */}
                <div
                  onClick={() => setActivePane("latency-charts")}
                  className="border border-slate-200 rounded-none bg-white p-8 hover:border-blue-600 transition-all cursor-pointer flex flex-col justify-between h-1/2 min-h-[140px] shadow-none group"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 font-bold uppercase tracking-widest">
                    <span>// Leakage Prevention</span>
                    <BadgeDollarSign className="w-4 h-4 text-red-500 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="pt-2">
                    <div className="text-4xl font-mono font-bold text-red-500 leading-none tracking-tighter">
                      ${leaksPrevented.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </div>
                    <p className="text-[10px] text-slate-450 font-bold uppercase mt-2.5 tracking-wider select-none">
                      Saved this hour / month
                    </p>
                  </div>
                </div>

                {/* Uptime and latency metric */}
                <div
                  onClick={() => setActivePane("latency-charts")}
                  className="border border-slate-200 rounded-none bg-white p-8 hover:border-blue-600 transition-all cursor-pointer flex flex-col justify-between h-1/2 min-h-[140px] shadow-none group"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 font-bold uppercase tracking-widest">
                    <span>// Success Score</span>
                    <Cpu className="w-4 h-4 text-green-650 group-hover:scale-110 transition-transform" />
                  </div>
                  <div className="pt-2">
                    <div className="text-4xl font-mono font-bold text-green-600 leading-none tracking-tighter">
                      {successScore}%
                    </div>
                    <p className="text-[10px] text-slate-450 font-bold uppercase mt-2.5 tracking-wider select-none">
                      Avg Stability | Latency: {latencyAvg}ms
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* LOWER LEVEL FEATURE ROW */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Feature Box 1 */}
              <div
                onClick={() => setActivePane("interactive-sim")}
                className="border border-slate-200 hover:border-blue-600 rounded-none bg-white p-6 transition-all cursor-pointer space-y-3 shadow-none group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-px bg-slate-300 group-hover:bg-blue-600 transition-colors"></div>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-slate-905 group-hover:text-blue-600 transition-colors">
                      Sledgehammer Kill-Switch
                    </span>
                  </div>
                  <div className="px-2 py-0.5 border border-red-200 bg-red-50 text-red-655 font-mono text-[9px] font-bold rounded-none select-none uppercase tracking-widest animate-pulse">
                    ARMED
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-9">
                  Actively evaluates loop heuristic weights of prompts and cognitive thread logs to sever runaway model recursion blocks before they bleed budgets.
                </p>
              </div>

              {/* Feature Box 2 */}
              <div
                onClick={() => setActivePane("latency-charts")}
                className="border border-slate-200 hover:border-blue-600 rounded-none bg-white p-6 transition-all cursor-pointer space-y-3 shadow-none group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-px bg-slate-300 group-hover:bg-blue-600 transition-colors"></div>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-slate-905 group-hover:text-blue-600 transition-colors">
                      Arbitration Router
                    </span>
                  </div>
                  <div className="px-2 py-0.5 border border-emerald-200 bg-emerald-50 text-emerald-655 font-mono text-[9px] font-bold rounded-none select-none uppercase tracking-widest">
                    ACTIVE
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-9">
                  Forces expensive endpoints to validate output utility. Safely route secondary reasoning queries down to faster models (e.g., Gemini 3.5 Flash).
                </p>
              </div>

              {/* Feature Box 3 */}
              <div
                onClick={() => setActivePane("forensic-lab")}
                className="border border-slate-200 hover:border-blue-600 rounded-none bg-white p-6 transition-all cursor-pointer space-y-3 shadow-none group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-px bg-slate-300 group-hover:bg-blue-600 transition-colors"></div>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-slate-905 group-hover:text-blue-600 transition-colors">
                      Diagnostic Autopsy Labor
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-blue-600 font-bold uppercase tracking-wider">
                    Gemini Core
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-normal pl-9">
                  Paste broken traces or prompt loops to let server-side artificial intelligence dissect loop root causes, estimate cost leak damage, and write repaired prompt script parameters.
                </p>
              </div>
            </div>

            {/* EMBEDDED DENSE CONSOLE MONITOR IN GRIDS VIEW */}
            <div className="border border-slate-200 bg-white p-8 rounded-none shadow-none">
              <AgentTerminal
                logsRef={logsRef}
                onClearLogs={handleClearLogs}
                onAddLog={addLog}
              />
            </div>
          </div>
        )}
      </main>

      {/* DETAILED ACTIVE ANALYST PANEL SHEETS / DRAWER DRAWER */}
      {activePane && (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs flex justify-end z-50 animate-fadeIn select-none">
          {/* Modal Overlay Background Click */}
          <div className="absolute inset-0" onClick={() => setActivePane(null)} />

          <div className="relative w-full max-w-2xl bg-white h-screen flex flex-col justify-between border-l border-slate-200 z-10 animate-slideLeft rounded-none shadow-2xl">
            
            {/* Sheet Header */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-slate-200 bg-slate-50/50 rounded-none">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 bg-black flex items-center justify-center transform rotate-45 shrink-0 select-none">
                  <div className="w-2 h-2 bg-white"></div>
                </div>
                <span className="text-xs font-mono font-bold text-slate-900 uppercase tracking-widest">
                  Prism Node Inspector Central
                </span>
              </div>
              <button
                onClick={() => setActivePane(null)}
                className="text-slate-400 hover:text-black hover:bg-slate-100 p-1.5 focus:outline-none transition-colors cursor-pointer rounded-none"
                title="Close Drawer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Dynamic Content Inside Sheet */}
            <div className="flex-1 overflow-y-auto p-8 scroll-smooth select-none">
              {activePane === "interactive-sim" && (
                <ProxySimulator
                  onSimulationRun={handleSimulationRun}
                  onAddLog={addLog}
                />
              )}

              {activePane === "latency-charts" && (
                <MetricCharts />
              )}

              {activePane === "terminal-logs" && (
                <AgentTerminal
                  logsRef={logsRef}
                  onClearLogs={handleClearLogs}
                  onAddLog={addLog}
                />
              )}

              {activePane === "forensic-lab" && (
                <ForensicsLab />
              )}
            </div>

            {/* Sheet Footer */}
            <div className="px-8 py-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-[10px] font-mono text-slate-400 select-none rounded-none font-bold uppercase tracking-wider">
              <span>PRISM-PROXY-IP_SECURE::1</span>
              <span>USER_REF: sandeep.majumder</span>
            </div>
          </div>
        </div>
      )}

      {/* DENSE FOOTER STAMP */}
      <footer className="w-full bg-white border-t border-slate-200 h-12 flex items-center justify-between px-8 text-[9px] font-bold uppercase tracking-widest text-slate-400 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <span>Platform Status:</span>
          <span className="text-green-600 inline-flex items-center gap-1.5 font-bold">
            <span className="w-1.5 h-1.5 bg-green-600 rounded-full animate-pulse" />
            OPERATIONAL
          </span>
        </div>
        <div className="flex gap-8">
          <span>Version 2.4.1-Stable</span>
          <span>&copy; 2024-2026 Prism Intelligence Corp</span>
        </div>
      </footer>
    </div>
  );
}
