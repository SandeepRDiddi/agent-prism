export interface TelemetryLog {
  timestamp: string;
  level: "PASS" | "INBOUND" | "METRIC" | "WARNING" | "INTERPRET" | "SLEDGEHAMMER_Killed" | "OPTIMIZER_DOWN_ROUTED" | "ERROR";
  message: string;
  service: string;
}

export interface ProxySimulationReport {
  prompt: string;
  intercepted: boolean;
  action: string;
  analysis: string;
  tokens: number;
  simulatedCost: number;
  savedCost: number;
  timestamp: string;
}

export interface AutopsyReport {
  verdict: "SLEDGEHAMMER_ALERT" | "COST_ANOMALY" | "LOGIC_LOCK" | "HEALTHY";
  loopRiskScore: number;
  rootCause: string;
  leakedTokens: number;
  estimatedWastedCost: number;
  reconstructedFlow: string[];
  patchedPrompt: string;
  preventionRecommendation: string;
}

export interface ProviderMetric {
  name: string;
  costPer1M: number;
  avgLatency: number;
  accuracy: number;
  concurrency: number;
  provider: "Google" | "OpenAI" | "Anthropic" | "Meta";
}
