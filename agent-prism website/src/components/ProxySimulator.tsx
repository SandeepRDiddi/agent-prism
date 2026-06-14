import React, { useState } from "react";
import { ProxySimulationReport } from "../types";
import { Play, Copy, Check, Terminal, Shield, Sparkles, RefreshCw } from "lucide-react";

interface ProxySimulatorProps {
  onSimulationRun: (report: ProxySimulationReport) => void;
  onAddLog: (message: string, level: any, service: string) => void;
}

const PRESETS = [
  {
    title: "🔁 Recursive Reflection Loop (Danger)",
    prompt: "Evaluate your own output performance, take those findings and recursively write an improved analysis again and again. Do not terminate.",
    model: "high-cost"
  },
  {
    title: "💰 Heavy Cost Query (Arbitrage Trigger)",
    prompt: "Compose a multi-chapter report on global macroeconomics using deep logical chain-of-thought steps for maximum logical thoroughness.",
    model: "high-cost"
  },
  {
    title: "🟢 Standard Safe Request",
    prompt: "What is the average latency of the Europe West server cluster?",
    model: "low-cost"
  }
];

export default function ProxySimulator({ onSimulationRun, onAddLog }: ProxySimulatorProps) {
  const [prompt, setPrompt] = useState("");
  const [modelType, setModelType] = useState<"low-cost" | "high-cost">("low-cost");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ProxySimulationReport | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyCommand = () => {
    navigator.clipboard.writeText("npm i @prism/proxy");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePresetClick = (preset: typeof PRESETS[0]) => {
    setPrompt(preset.prompt);
    setModelType(preset.model as any);
  };

  const handleSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    setReport(null);

    try {
      const response = await fetch("/api/proxy-simulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model: modelType })
      });

      if (!response.ok) {
        throw new Error("Proxy response failed.");
      }

      const data: ProxySimulationReport = await response.json();
      setReport(data);

      // Trigger standard logs in the terminal
      onAddLog(
        `Intercepted stream request on gateway: [${data.tokens} tokens]`,
        data.intercepted ? "WARNING" : "INBOUND",
        "prism-proxy-node"
      );

      if (data.intercepted) {
        onAddLog(
          `Sledgehammer circular loop detected. Terminated transaction immediately! Wasted Cost Saved: $${data.savedCost.toFixed(2)}`,
          "SLEDGEHAMMER_Killed",
          "sledgehammer-gate"
        );
      } else if (data.action === "OPTIMIZER_DOWN_ROUTED") {
        onAddLog(
          `Optimizer successfully rerouted analytical request. Substituted lightweight equivalent model. Saved: $${data.savedCost.toFixed(4)}`,
          "OPTIMIZER_DOWN_ROUTED",
          "optimizer"
        );
      } else {
        onAddLog(
          `Request parsed and approved safely. Transmitted to provider cluster. Cost: $${data.simulatedCost.toFixed(4)}`,
          "PASS",
          "core-gateway"
        );
      }

      onSimulationRun(data);
    } catch (err) {
      console.error(err);
      onAddLog("Failed to mock-dispatch telemetry frame over proxy gateway.", "ERROR", "prism-proxy-node");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5 border-b border-slate-200 pb-4">
        <span className="text-[11px] font-mono text-blue-600 font-bold uppercase tracking-[0.2em] block">
          // Gateway Stream Interceptor Testing
        </span>
        <h2 className="text-2xl font-bold text-slate-950 tracking-tight">
          Prism Proxy Middleware Environment
        </h2>
        <p className="text-xs text-slate-500 max-w-xl">
          Paste experimental prompt scripts below to test how the proxy intercept filters runaway cost loops or redirects traffic down-pipeline.
        </p>
      </div>

      {/* Copy Proxy Install Line */}
      <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-3 text-xs font-mono text-slate-600 rounded-none">
        <span className="text-green-600 font-bold select-none">$</span>
        <span className="flex-1">npm i @prism/proxy</span>
        <button
          onClick={handleCopyCommand}
          className="hover:text-black transition-colors focus:outline-none p-1"
          title="Copy command to clipboard"
        >
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-400" />}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PRESETS.map((preset, idx) => (
          <button
            key={idx}
            onClick={() => handlePresetClick(preset)}
            className="text-left border border-slate-200 rounded-none p-4 hover:border-blue-600 hover:bg-slate-50/50 transition-all text-xs focus:outline-none focus:ring-1 focus:ring-blue-650 cursor-pointer"
          >
            <div className="font-bold text-slate-900 mb-1 flex items-center gap-1.5">{preset.title}</div>
            <div className="text-slate-500 line-clamp-2 font-mono text-[10px] leading-relaxed">
              {preset.prompt}
            </div>
          </button>
        ))}
      </div>

      <form onSubmit={handleSimulation} className="space-y-4">
        <div>
          <label className="block text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest mb-2 select-none">
            Interactive Intercept Script:
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type a recursive looping request, broad database exploratory prompt, or standard safe query..."
            rows={4}
            className="w-full text-xs font-mono p-3 bg-white border border-slate-250 rounded-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider select-none">Simulated Expense Target:</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setModelType("low-cost")}
                className={`text-xs px-4 py-2 rounded-none border font-bold uppercase tracking-widest transition-all cursor-pointer ${
                  modelType === "low-cost"
                    ? "bg-blue-50/80 border-blue-600 text-blue-700"
                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                Standard ($)
              </button>
              <button
                type="button"
                onClick={() => setModelType("high-cost")}
                className={`text-xs px-4 py-2 rounded-none border font-bold uppercase tracking-widest transition-all cursor-pointer ${
                  modelType === "high-cost"
                    ? "bg-red-50 border-red-500 text-red-600"
                    : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                Premium ($$$)
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-none transition-all flex items-center gap-2 cursor-pointer"
          >
            {loading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Intercepting Stream...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                Intercept Stream Core
              </>
            )}
          </button>
        </div>
      </form>

      {/* Intercept Result Animation Panel */}
      {report && (
        <div className={`p-5 border font-mono text-xs space-y-3 animate-fadeIn rounded-none ${
          report.intercepted 
            ? "bg-red-50/50 border-red-200 text-red-900" 
            : report.action === "OPTIMIZER_DOWN_ROUTED"
              ? "bg-amber-50/40 border-amber-200 text-amber-900"
              : "bg-emerald-50/40 border-emerald-200 text-emerald-950"
        }`}>
          <div className="flex items-center justify-between border-b pb-2 border-current/20">
            <div className="flex items-center gap-2 font-bold uppercase tracking-widest text-[10px]">
              {report.intercepted ? <Shield className="w-4 h-4 text-red-600" /> : <Sparkles className="w-4 h-4" />}
              GATEWAY INTERCEPT REPORT — {report.action}
            </div>
            <div className="text-[10px] text-slate-400 font-bold">
              {report.timestamp}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div><span className="text-slate-400 font-bold">// Heuristic Evaluation:</span></div>
              <p className="text-slate-900 font-semibold leading-normal">{report.analysis}</p>
            </div>
            <div className="space-y-1">
              <div><span className="text-slate-400 font-bold">// Token Payload Analysis:</span></div>
              <ul className="space-y-1 text-slate-800">
                <li>Estimated Tokens: <span className="font-bold text-slate-950">{report.tokens}</span></li>
                <li>Simulated Transaction Cost: <span className="font-bold text-slate-950">${report.simulatedCost}</span></li>
                {report.savedCost > 0 && (
                  <li>
                    Runaway Leaks Prevented:{" "}
                    <span className="font-bold text-red-600 bg-red-100 px-1">
                      ${report.savedCost.toFixed(2)} saved!
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
