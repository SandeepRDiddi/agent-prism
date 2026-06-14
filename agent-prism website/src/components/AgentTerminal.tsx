import React, { useState, useEffect, useRef } from "react";
import { TelemetryLog } from "../types";
import { Terminal, Shield, Play, Pause, Trash2, Search, SlidersHorizontal, Sparkles } from "lucide-react";

interface AgentTerminalProps {
  logsRef: React.MutableRefObject<TelemetryLog[]>;
  onClearLogs: () => void;
  onAddLog: (message: string, level: TelemetryLog["level"], service: string) => void;
}

export default function AgentTerminal({ logsRef, onClearLogs, onAddLog }: AgentTerminalProps) {
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isPaused, setIsPaused] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Synchronize state with incoming ref-backed log buffers
  useEffect(() => {
    const updateState = () => {
      setLogs([...logsRef.current]);
    };

    updateState();
    const interval = setInterval(() => {
      if (!isPaused) {
        updateState();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [logsRef, isPaused]);

  // Handle auto scrolling
  useEffect(() => {
    if (scrollContainerRef.current && !isPaused) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, isPaused]);

  // Background mock generator to keep telemetry lively
  useEffect(() => {
    const mockServices = ["optimizer", "sledgehammer-gate", "core-gateway", "prism-proxy-node"];
    const mockLogs = [
      { msg: "Parsed structural outputs against cognitive map context", lvl: "PASS" as const },
      { msg: "Latency performance checkpoint completed for regional nodes", lvl: "PASS" as const },
      { msg: "Down-routed secondary evaluation. Active budgets optimized", lvl: "OPTIMIZER_DOWN_ROUTED" as const },
      { msg: "Verified token cycle density score: Healthy (0.12)", lvl: "METRIC" as const },
      { msg: "Budget thresholds check: total session cumulative cost at 72.5% limit", lvl: "METRIC" as const },
      { msg: "Token generation burst limit matched on Anthropic pipeline. Queue managed.", lvl: "WARNING" as const }
    ];

    const generateLog = () => {
      if (isPaused) return;
      const index = Math.floor(Math.random() * mockLogs.length);
      const service = mockServices[Math.floor(Math.random() * mockServices.length)];
      onAddLog(mockLogs[index].msg, mockLogs[index].lvl, service);
    };

    const interval = setInterval(generateLog, 4000);
    return () => clearInterval(interval);
  }, [isPaused, onAddLog]);

  const filteredLogs = logs.filter(log => {
    const matchesLevel = filterLevel === "all" || log.level === filterLevel;
    const matchesSearch = log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          log.service.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  const getLevelColor = (level: TelemetryLog["level"]) => {
    switch (level) {
      case "PASS": return "text-[#34a853]";
      case "INBOUND": return "text-[#1a0dab]";
      case "METRIC": return "text-gray-400";
      case "WARNING": return "text-[#fbbc05]";
      case "SLEDGEHAMMER_Killed": return "text-red-600 font-extrabold animate-pulse bg-red-100 px-1";
      case "OPTIMIZER_DOWN_ROUTED": return "text-blue-500 font-semibold";
      case "ERROR": return "text-red-500 font-semibold";
      default: return "text-gray-500";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1.5 border-b border-slate-200 pb-4">
        <span className="text-[11px] font-mono text-blue-600 font-bold uppercase tracking-[0.2em] block">
          // Gateway Telemetry Feed
        </span>
        <h2 className="text-2xl font-bold text-slate-950 tracking-tight">
          Prism Node Inbound Session Trace
        </h2>
        <p className="text-xs text-slate-500 max-w-xl">
          Live intercepted logs representing multi-agent requests scrolling across the gateway proxy servers. Filter levels to isolate alerts or diagnostic issues.
        </p>
      </div>

      {/* Toolbar / Search Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 border border-slate-200 rounded-none">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search log messages or services..."
            className="text-xs font-mono bg-transparent outline-none w-full border-b border-transparent focus:border-slate-300 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value)}
            className="text-xs font-mono bg-white border border-slate-200 outline-none p-1.5 rounded-none focus:ring-1 focus:ring-blue-600 font-bold"
          >
            <option value="all">Level: All</option>
            <option value="PASS">PASS</option>
            <option value="INBOUND">INBOUND</option>
            <option value="METRIC">METRIC</option>
            <option value="WARNING">WARNING</option>
            <option value="SLEDGEHAMMER_Killed">Killed (Sledgehammer)</option>
            <option value="OPTIMIZER_DOWN_ROUTED">Optimizer Redirects</option>
            <option value="ERROR">ERROR</option>
          </select>

          <div className="border-l border-slate-200 pl-2 flex items-center gap-1.5">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="text-slate-600 hover:text-black hover:bg-slate-100 p-1.5 rounded-none focus:outline-none transition-colors cursor-pointer"
              title={isPaused ? "Resume log stream" : "Pause log stream"}
            >
              {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClearLogs}
              className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-none focus:outline-none transition-colors cursor-pointer"
              title="Clear log terminal stream"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Terminal Grid Output */}
      <div
        ref={scrollContainerRef}
        className="bg-slate-950 border border-slate-900 rounded-none p-5 h-[320px] overflow-y-auto font-mono text-xs text-slate-300 space-y-2 select-text shadow-inner"
      >
        <div className="flex items-center justify-between border-b border-slate-900 pb-1.5 mb-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full bg-green-500 ${isPaused ? "" : "animate-pulse"}`} />
            CENTRAL_PROXY_MONITORING
          </span>
          <span>SYSTEM TIME: {new Date().toLocaleTimeString()}</span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="text-slate-500 py-12 text-center select-none font-medium">To filter limits: No execution logs matched queries.</div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div key={idx} className="flex flex-col md:flex-row md:items-start gap-2 py-1 hover:bg-slate-900 border-b border-slate-900/30 rounded-none transition-all px-1">
              <span className="text-slate-500 whitespace-nowrap min-w-[70px] select-none">{log.timestamp}</span>
              <span className={`${getLevelColor(log.level)} font-extrabold whitespace-nowrap min-w-[140px] select-none text-[10px]`}>
                [{log.level}]
              </span>
              <span className="text-slate-400 font-semibold whitespace-nowrap min-w-[130px] pr-2 select-none">
                @{log.service}
              </span>
              <span className="text-slate-205 leading-normal break-all">{log.message}</span>
            </div>
          ))
        )}
      </div>

      {/* Trigger testing simulation payload inside terminal directly */}
      <div className="bg-slate-50 border border-slate-200 rounded-none p-4 flex flex-wrap gap-3 items-center justify-between text-xs select-none">
        <div className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">// Generate specific diagnostic test logs:</div>
        <div className="flex gap-2">
          <button
            onClick={() => onAddLog("Dispatched active ping heartbeat: OK. Endpoint Europe cluster reachable.", "PASS", "prism-proxy-node")}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-none cursor-pointer transition-colors"
          >
            Heartbeat Ping
          </button>
          <button
            onClick={() => onAddLog("Latency anomaly detected on Anthropic endpoints cluster. Rerouting rules established.", "WARNING", "core-gateway")}
            className="border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-none cursor-pointer transition-colors"
          >
            Trigger Warning
          </button>
        </div>
      </div>
    </div>
  );
}
