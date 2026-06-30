import React, { useState } from "react";
import { ProviderMetric } from "../types";
import { TrendingUp, DollarSign, Activity, CheckCircle, Award } from "lucide-react";

const PROVIDER_DATA: ProviderMetric[] = [
  { name: "Gemini 3.5 Flash", costPer1M: 0.075, avgLatency: 82, accuracy: 94.8, concurrency: 120, provider: "Google" },
  { name: "Gemini 3.1 Flash-Lite", costPer1M: 0.035, avgLatency: 52, accuracy: 89.1, concurrency: 250, provider: "Google" },
  { name: "Claude 3.5 Sonnet", costPer1M: 3.00, avgLatency: 218, accuracy: 96.8, concurrency: 50, provider: "Anthropic" },
  { name: "Claude 3.1 Haiku", costPer1M: 0.25, avgLatency: 112, accuracy: 91.2, concurrency: 100, provider: "Anthropic" },
  { name: "GPT-4o Standard", costPer1M: 5.00, avgLatency: 178, accuracy: 96.2, concurrency: 60, provider: "OpenAI" },
  { name: "GPT-4o-Mini", costPer1M: 0.15, avgLatency: 95, accuracy: 91.8, concurrency: 150, provider: "OpenAI" },
  { name: "Llama 3.1 70B", costPer1M: 0.60, avgLatency: 135, accuracy: 89.5, concurrency: 80, provider: "Meta" }
];

export default function MetricCharts() {
  const [metricTab, setMetricTab] = useState<"latency" | "cost" | "accuracy">("latency");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Sorting parameters dynamically
  const sortedData = [...PROVIDER_DATA].sort((a, b) => {
    if (metricTab === "latency") return a.avgLatency - b.avgLatency;
    if (metricTab === "cost") return a.costPer1M - b.costPer1M;
    return b.accuracy - a.accuracy;
  });

  const maxVal = Math.max(...PROVIDER_DATA.map(d => {
    if (metricTab === "latency") return d.avgLatency;
    if (metricTab === "cost") return d.costPer1M;
    return d.accuracy;
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1.5 border-b border-slate-200 pb-4">
        <span className="text-[11px] font-mono text-blue-600 font-bold uppercase tracking-[0.2em] block mb-1">
          // Cross-Provider Arbitration
        </span>
        <h2 className="text-2xl font-bold text-slate-950 tracking-tight">
          Performance & Cost Intelligence
        </h2>
        <p className="text-xs text-slate-500 max-w-xl">
          Compare global response times, token-allocation pricing, and real-time success margins. Agent Prism arbitrates queries to maintain high-speed routing.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border border-slate-200 bg-slate-50 p-1 rounded-none gap-1 select-none">
        <button
          onClick={() => setMetricTab("latency")}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-3 rounded-none transition-all cursor-pointer ${
            metricTab === "latency"
              ? "bg-black text-white"
              : "border-transparent text-slate-500 hover:text-slate-950 hover:bg-slate-100/80"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Latency (ms)
        </button>
        <button
          onClick={() => setMetricTab("cost")}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-3 rounded-none transition-all cursor-pointer ${
            metricTab === "cost"
              ? "bg-black text-white"
              : "border-transparent text-slate-500 hover:text-slate-950 hover:bg-slate-100/80"
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          Cost / 1M ($)
        </button>
        <button
          onClick={() => setMetricTab("accuracy")}
          className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-3 rounded-none transition-all cursor-pointer ${
            metricTab === "accuracy"
              ? "bg-black text-white"
              : "border-transparent text-slate-500 hover:text-slate-950 hover:bg-slate-100/80"
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Reliability (%)
        </button>
      </div>

      {/* Modern Responsive SVG Chart */}
      <div className="bg-slate-50 border border-slate-200 p-6 rounded-none">
        <div className="flex justify-between items-center mb-4">
          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-widest block">
            {metricTab === "latency" ? "Lowest latency (ms) matches best speed performance" : metricTab === "cost" ? "Allocative Cost savings comparison" : "Target intelligence ratings"}
          </span>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
            <span className="inline-block w-2.5 h-2.5 bg-blue-600"></span> Google Cluster
            <span className="inline-block w-2.5 h-2.5 bg-slate-400 ml-2"></span> Other Networks
          </div>
        </div>

        <div className="space-y-3.5">
          {sortedData.map((item) => {
            const val = metricTab === "latency" ? item.avgLatency : metricTab === "cost" ? item.costPer1M : item.accuracy;
            const percentage = (val / maxVal) * 100;
            const isGoogle = item.provider === "Google";
            const rowSelected = selectedProvider === item.name;

            return (
              <div
                key={item.name}
                onClick={() => setSelectedProvider(selectedProvider === item.name ? null : item.name)}
                className={`group cursor-pointer p-2.5 rounded-none transition-all border ${
                  rowSelected ? "bg-blue-50/40 border-blue-400" : "hover:bg-slate-100/60 border-transparent"
                }`}
              >
                <div className="flex justify-between text-xs mb-1.5 font-mono">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    {item.name}
                    {isGoogle && (
                      <span className="text-[9px] bg-green-50 text-green-700 px-1 py-0.2 border border-green-200 font-bold tracking-tight">
                        EFFICIENT
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-slate-700">
                    {metricTab === "latency" ? `${item.avgLatency} ms` : metricTab === "cost" ? `$${item.costPer1M.toFixed(3)}` : `${item.accuracy}%`}
                  </span>
                </div>
                <div className="w-full bg-slate-200 h-2.5 rounded-none overflow-hidden relative">
                  <div
                    style={{ width: `${percentage}%` }}
                    className={`h-full transition-all duration-500 ${
                      isGoogle ? "bg-blue-600 group-hover:bg-blue-700" : "bg-slate-400 group-hover:bg-slate-500"
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {selectedProvider && (
          <div className="mt-4 p-4 bg-white border border-slate-200 rounded-none font-mono text-[11px] text-slate-800 animate-fadeIn">
            <div className="font-extrabold text-slate-950 border-b pb-1.5 mb-2 uppercase tracking-wider text-[10px]">// {selectedProvider} Forensic Signature</div>
            {(() => {
              const info = PROVIDER_DATA.find(d => d.name === selectedProvider);
              if (!info) return null;
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>Provider: <span className="text-slate-950 font-bold">{info.provider}</span></div>
                  <div>Avg Latency: <span className="text-slate-950 font-bold">{info.avgLatency}ms</span></div>
                  <div>Cost / 1M input: <span className="text-slate-950 font-bold">${info.costPer1M.toFixed(2)}</span></div>
                  <div>Reliability Score: <span className="text-slate-950 font-bold">{info.accuracy}%</span></div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Model Arbitration Rules Table */}
      <div className="overflow-x-auto border border-slate-200 rounded-none">
        <table className="min-w-full divide-y divide-slate-250 text-xs">
          <thead className="bg-slate-50 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold">
            <tr>
              <th className="px-4 py-3 text-left">Routing Endpoint</th>
              <th className="px-4 py-3 text-left">Budget Priority</th>
              <th className="px-4 py-3 text-left">Latency Threshold</th>
              <th className="px-4 py-3 text-left">Target Heuristic Mode</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 font-mono text-slate-700">
            <tr className="hover:bg-slate-50/50">
              <td className="px-4 py-3 text-slate-950 font-bold">Gemini 3.5 Flash</td>
              <td className="px-4 py-3 text-green-700 font-bold">★ High (S-Tier Cost)</td>
              <td className="px-4 py-3 text-emerald-600 font-bold">&lt; 100ms</td>
              <td className="px-4 py-3">Optimized default pipeline</td>
            </tr>
            <tr className="hover:bg-slate-50/50">
              <td className="px-4 py-3 text-slate-950 font-bold">Gemini 3.1 Flash-Lite</td>
              <td className="px-4 py-3 text-green-700 font-bold">★ Max Savings</td>
              <td className="px-4 py-3 text-emerald-600 font-bold">&lt; 60ms</td>
              <td className="px-4 py-3">Deep down-routed arbitrage fallback</td>
            </tr>
            <tr className="hover:bg-slate-50/50">
              <td className="px-4 py-3 text-slate-950 font-bold">Claude 3.5 Sonnet</td>
              <td className="px-4 py-3 text-red-600 font-bold">Reserved for Reasoning</td>
              <td className="px-4 py-3 text-amber-600 font-bold">&lt; 250ms</td>
              <td className="px-4 py-3">Intense cognitive tasking only</td>
            </tr>
            <tr className="hover:bg-slate-50/50">
              <td className="px-4 py-3 text-slate-950 font-bold">GPT-4o Standard</td>
              <td className="px-4 py-3 text-red-600 font-bold">Reserved for Reasoning</td>
              <td className="px-4 py-3 text-amber-600 font-bold">&lt; 200ms</td>
              <td className="px-4 py-3">Trace analysis & cross-interrogations</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
