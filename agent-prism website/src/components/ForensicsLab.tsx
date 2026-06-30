import React, { useState, useRef } from "react";
import { AutopsyReport } from "../types";
import { AlertTriangle, ShieldCheck, Zap, RefreshCw, FileText, Bot, UploadCloud, Copy, Check, Info } from "lucide-react";

const TRACE_TEMPLATES = [
  {
    name: "🔁 Circular Reflection Trap",
    prompt: "Prompt: 'Read the previous summary, refine it with added granular details, and repeat this refinement process recursively to maximize precision.'",
    log: "[00:01:02] [INBOUND] Processing refinement request (Iteration 1)\n[00:01:05] [PASS] Generation complete (Tokens: 3,100)\n[00:01:06] [INBOUND] Auto-triggering self-reflection sequence (Iteration 2)\n[00:01:10] [PASS] Refined output generated (Tokens: 5,900)\n[00:01:11] [INBOUND] Auto-triggering self-reflection sequence (Iteration 3)\n[00:01:16] [PASS] Loop density exponential expansion. Frame size exceeded boundary thresholds. Buffer: 18,200 tokens..."
  },
  {
    name: "🔒 Logic Lock (Deadlock)",
    prompt: "Prompt: 'Agent A: Coordinate with Agent B to determine budget limits. Do not terminate until Agent B explicitly signs off. Agent B: Await Agent A's direct budget assessment. Do not sign off until Agent A is fully complete.'",
    log: "[03:14:00] [INBOUND] Agent A awaiting Agent B budget limits.\n[03:14:02] [INBOUND] Agent B awaiting Agent A budget signature.\n[03:15:00] [WARNING] Thread inactive: No signal events exchanged on telemetry channel for 60 seconds.\n[03:16:00] [WARNING] Thread inactive: Still locked in mutual wait status. Budget exceeded: +$0.55 idle cost."
  },
  {
    name: "💸 Exploding Parameter Cost Spikes",
    prompt: "Prompt: 'Extract key names, locations, numbers, metadata profiles, semantic themes, sentiment values, logical contradictions, and grammar warnings for every single sentence of this 800-page transcript.'",
    log: "[12:00:01] [INBOUND] Triggering prompt chunking over Claude 3.5 Sonnet\n[12:00:05] [METRIC] Aggregated inputs: 1,480,000 tokens\n[12:00:07] [METRIC] Concurrent pipeline burst: +40 active sub-queries spawned over Anthropic node queue\n[12:00:22] [WARNING] Cost anomaly trigger: Total query session spike registered: +$38.40 within 20 seconds."
  }
];

export default function ForensicsLab() {
  const [promptInput, setPromptInput] = useState("");
  const [logInput, setLogInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AutopsyReport | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTemplate = (tpl: typeof TRACE_TEMPLATES[0]) => {
    setPromptInput(tpl.prompt);
    setLogInput(tpl.log);
    setReport(null);
  };

  const runAutopsy = async () => {
    if (!promptInput.trim() && !logInput.trim()) return;
    setLoading(true);
    setReport(null);

    try {
      const res = await fetch("/api/autopsy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptInput, traceLog: logInput })
      });

      if (!res.ok) {
        throw new Error("Autopsy server processing error.");
      }

      const data: AutopsyReport = await res.json();
      setReport(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPrompt = () => {
    if (!report) return;
    navigator.clipboard.writeText(report.patchedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Drag and Drop File Event Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      readFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      readFile(e.target.files[0]);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setLogInput(text);
        if (!promptInput) {
          setPromptInput(`Uploaded log file: ${file.name}`);
        }
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5 border-b border-slate-200 pb-4">
        <span className="text-[11px] font-mono text-blue-600 font-bold uppercase tracking-[0.2em] block">
          // AI Forensic Lab
        </span>
        <h2 className="text-2xl font-bold text-slate-950 tracking-tight">
          Cognitive Forensic Autopsy Core
        </h2>
        <p className="text-xs text-slate-500 max-w-xl">
          Harness server-side Gemini intelligence to diagnose rogue agent behaviors, recursive loop stack traces, or budget anomalies, generating immediate containment remedies.
        </p>
      </div>

      {/* Preset templates */}
      <div className="space-y-2 select-none">
        <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">
          // Load Anomaly Templates:
        </span>
        <div className="flex flex-wrap gap-2">
          {TRACE_TEMPLATES.map((tpl, i) => (
            <button
              key={i}
              onClick={() => loadTemplate(tpl)}
              className="text-xs bg-white border border-slate-200 hover:border-blue-600 hover:bg-slate-50/50 px-3.5 py-2 transition-all text-slate-700 font-bold uppercase tracking-wider rounded-none cursor-pointer"
            >
              {tpl.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Input prompt schema checks */}
        <div>
          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-2 select-none">
            // Target Prompt Script:
          </label>
          <textarea
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder="Introduce the agent's faulty prompt task structure here..."
            className="w-full text-xs font-mono p-3 bg-white border border-slate-250 rounded-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none h-[120px] resize-none"
          />
        </div>

        {/* Input execution traces with File Upload drag/drop support */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest select-none">
              // Telemetry Execution Trace:
            </label>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] text-blue-600 font-mono font-bold uppercase tracking-widest hover:underline cursor-pointer"
            >
              Select Trace Log File
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".txt,.log,.json"
              className="hidden"
            />
          </div>

          <div
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`w-full relative rounded-none border-2 border-dashed h-[120px] transition-all flex flex-col items-center justify-center ${
              dragActive 
                ? "border-blue-600 bg-blue-50/50" 
                : "border-slate-300 bg-white"
            }`}
          >
            {logInput ? (
              <textarea
                value={logInput}
                onChange={(e) => setLogInput(e.target.value)}
                placeholder="Paste telemetry errors, infinite console streams, or trace vectors..."
                className="w-full h-full text-xs font-mono p-3 bg-transparent outline-none border-0 resize-none"
              />
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1.5 text-slate-400 font-mono text-[11px] cursor-pointer select-none p-4 text-center w-full"
              >
                <UploadCloud className="w-8 h-8 text-slate-300 mb-1" />
                <span>Drag & Drop Trace Log File here</span>
                <span className="text-[10px] text-slate-400 font-bold tracking-wider">(or click to select)</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        {(promptInput || logInput) && (
          <button
            onClick={() => {
              setPromptInput("");
              setLogInput("");
              setReport(null);
            }}
            className="border border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-bold uppercase tracking-widest px-5 py-3 transition-colors rounded-none cursor-pointer"
          >
            Clear Inputs
          </button>
        )}
        <button
          onClick={runAutopsy}
          disabled={loading || (!promptInput.trim() && !logInput.trim())}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-450 text-white font-bold uppercase tracking-widest text-xs px-6 py-3 transition-colors flex items-center gap-2 rounded-none cursor-pointer select-none"
        >
          {loading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Analyzing Cognitive Trajectory...
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 fill-current" />
              Perform Forensic Autopsy
            </>
          )}
        </button>
      </div>

      {/* Autopsy Response results */}
      {report && (
        <div className="border border-slate-200 rounded-none bg-white p-6 space-y-6 animate-fadeIn shadow-none">
          {/* Autopsy Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-4 gap-3 select-none">
            <div className="flex items-center gap-2.5">
              {report.verdict === "SLEDGEHAMMER_ALERT" ? (
                <span className="flex items-center gap-2 bg-red-50 text-red-700 font-mono font-bold text-[10px] border border-red-200 px-3 py-1.5 rounded-none uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4 text-red-650" />
                  CRITICAL SLEDGEHAMMER SAFETY TRAP MATCHED
                </span>
              ) : report.verdict === "LOGIC_LOCK" ? (
                <span className="flex items-center gap-2 bg-yellow-55 text-amber-800 font-mono font-bold text-[10px] border border-amber-200 px-3 py-1.5 rounded-none uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  LOGIC LOCK / DEADLOCK DETECTED
                </span>
              ) : report.verdict === "COST_ANOMALY" ? (
                <span className="flex items-center gap-2 bg-orange-50/75 text-orange-850 font-mono font-bold text-[10px] border border-orange-200 px-3 py-1.5 rounded-none uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  COST WINDOW ANOMALY EXTRAPOLATION
                </span>
              ) : (
                <span className="flex items-center gap-2 bg-green-50 text-green-700 font-mono font-bold text-[10px] border border-green-200 px-3 py-1.5 rounded-none uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4 text-green-600" />
                  HEALTHY CONSTRAINTS VERIFICATION
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 font-mono text-[10px] text-slate-400">
              <span className="font-bold text-slate-800 uppercase tracking-wider">// Severity Rating:</span>
              <span className="font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-none">
                {report.loopRiskScore}% Loop Risk
              </span>
            </div>
          </div>

          {/* Core Analysis Summary Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-b border-slate-200 pb-4">
            <div className="bg-slate-50 border border-slate-200 rounded-none p-4 text-center">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest select-none">// Leaked Tokens</div>
              <div className="text-2xl font-mono font-bold text-slate-950 mt-1">
                {report.leakedTokens.toLocaleString()}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-none p-4 text-center">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest select-none">// Estimated Wasted Cost</div>
              <div className="text-2xl font-mono font-bold text-red-655 mt-1">
                ${report.estimatedWastedCost.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-none p-4 text-center">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest select-none">// Verdict Classification</div>
              <div className="text-sm font-bold text-slate-950 mt-2 tracking-widest uppercase select-none">
                {report.verdict.replace("_", " ")}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {/* Root Cause description */}
            <div className="space-y-1.5">
              <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider block select-none">
                // Forensic Diagnosis Root Cause
              </span>
              <p className="text-xs text-slate-800 leading-relaxed font-sans bg-slate-50 border-l-2 border-slate-500 p-3 rounded-none whitespace-pre-line">
                {report.rootCause}
              </p>
            </div>

            {/* Reconstructed Flow Step-Timeline */}
            {report.reconstructedFlow && report.reconstructedFlow.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider block select-none">
                  // Reconstructed Execution Cycle Journey
                </span>
                <div className="font-mono text-[11px] border border-slate-100 p-4 space-y-2.5 bg-slate-50/60 text-slate-600 rounded-none">
                  {report.reconstructedFlow.map((flowStep, flowIdx) => (
                    <div key={flowIdx} className="flex gap-2.5 items-start">
                      <span className="text-blue-600 font-extrabold select-none">[{flowIdx + 1}]</span>
                      <p className="text-slate-850 leading-normal">{flowStep}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Remediation - Patched Prompt Script */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center bg-slate-950 p-3 text-slate-400 text-[10px] font-mono border-b border-slate-900 rounded-none select-none">
                <span className="text-green-400 font-bold tracking-widest">// REMEDIATION_REPLACEMENT_PROMPT</span>
                <button
                  onClick={handleCopyPrompt}
                  className="flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors focus:outline-none cursor-pointer text-[10px] font-bold tracking-widest"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-400" />
                      COPIED_REPAIR
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      COPY_REPAIR_SCRIPT
                    </>
                  )}
                </button>
              </div>
              <pre className="text-xs font-mono bg-slate-950 text-green-450 p-4 h-36 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text border border-slate-900 rounded-none">
                {report.patchedPrompt}
              </pre>
            </div>

            {/* Recommendations detail */}
            <div className="space-y-1.5 p-4 bg-blue-50/30 border border-blue-105 text-xs select-none rounded-none">
              <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-blue-800 uppercase tracking-wider">
                <Info className="w-4 h-4 text-blue-600" />
                Safety Containment Recommendation:
              </div>
              <p className="text-slate-700 leading-normal font-sans pt-1">
                {report.preventionRecommendation}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
