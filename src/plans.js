// Plan definitions — single source of truth for all limit enforcement
export const PLANS = {
  free: {
    name: "Free",
    maxAgents: 5,
    maxRunsPerMonth: 500,
    gatewayAccess: false,
    promptCapture: false,
    aiAdvisor: false,
    teamMembers: 1,
    dataRetentionDays: 30,
    support: "community"
  },
  starter: {
    name: "Starter",
    maxAgents: 20,
    maxRunsPerMonth: 5000,
    gatewayAccess: true,
    promptCapture: false,
    aiAdvisor: true,
    teamMembers: 5,
    dataRetentionDays: 90,
    support: "email"
  },
  pro: {
    name: "Pro",
    maxAgents: 100,
    maxRunsPerMonth: 50000,
    gatewayAccess: true,
    promptCapture: true,
    aiAdvisor: true,
    teamMembers: 25,
    dataRetentionDays: 365,
    support: "priority"
  },
  enterprise: {
    name: "Enterprise",
    maxAgents: Infinity,
    maxRunsPerMonth: Infinity,
    gatewayAccess: true,
    promptCapture: true,
    aiAdvisor: true,
    teamMembers: Infinity,
    dataRetentionDays: Infinity,
    support: "dedicated"
  },
  // Legacy value used by bootstrap — treat as enterprise
  "enterprise-trial": {
    name: "Enterprise Trial",
    maxAgents: Infinity,
    maxRunsPerMonth: Infinity,
    gatewayAccess: true,
    promptCapture: true,
    aiAdvisor: true,
    teamMembers: Infinity,
    dataRetentionDays: 90,
    support: "priority"
  }
};

export function getPlan(planName) {
  return PLANS[planName] || PLANS.free;
}

/**
 * Compute current usage metrics for a tenant from their runs.
 * @param {Array} runs - all tenant runs
 * @returns {{ agentCount, uniqueAgents, monthlyRuns }}
 */
export function computeUsage(runs) {
  const uniqueAgents = new Set(runs.map(r => r.agentName).filter(Boolean));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();
  const monthlyRuns = runs.filter(r => (r.startTime || "") >= monthStartIso).length;
  return {
    agentCount: uniqueAgents.size,
    uniqueAgents: [...uniqueAgents],
    monthlyRuns
  };
}

/**
 * Check if a new ingest is allowed under the tenant's plan.
 * @param {object} tenant - tenant record with .plan
 * @param {Array} existingRuns - all existing tenant runs
 * @param {string} incomingAgentName - agent name in the new run
 * @returns {{ allowed: boolean, reason?: string, upgrade?: object }}
 */
export function checkIngestAllowed(tenant, existingRuns, incomingAgentName) {
  const plan = getPlan(tenant.plan);
  const usage = computeUsage(existingRuns);

  // Monthly run cap
  if (plan.maxRunsPerMonth !== Infinity && usage.monthlyRuns >= plan.maxRunsPerMonth) {
    return {
      allowed: false,
      code: "run_limit_reached",
      reason: `Your ${plan.name} plan allows ${plan.maxRunsPerMonth.toLocaleString()} runs/month. You've used ${usage.monthlyRuns.toLocaleString()}.`,
      usage,
      plan: plan.name,
      upgrade: upgradePrompt(tenant.plan, "monthly run limit")
    };
  }

  // Agent cap — only triggered when new agent name is seen
  if (plan.maxAgents !== Infinity) {
    const isNewAgent = incomingAgentName && !usage.uniqueAgents.includes(incomingAgentName);
    if (isNewAgent && usage.agentCount >= plan.maxAgents) {
      return {
        allowed: false,
        code: "agent_limit_reached",
        reason: `Your ${plan.name} plan supports up to ${plan.maxAgents} agents. You've registered ${usage.agentCount} (${usage.uniqueAgents.join(", ")}). Upgrade to monitor more agents.`,
        usage,
        plan: plan.name,
        upgrade: upgradePrompt(tenant.plan, `${plan.maxAgents}-agent limit`)
      };
    }
  }

  return { allowed: true, usage, plan: plan.name };
}

/**
 * Check if a gateway feature is allowed under the tenant's plan.
 */
export function checkGatewayAllowed(tenant) {
  const plan = getPlan(tenant.plan);
  if (!plan.gatewayAccess) {
    return {
      allowed: false,
      code: "gateway_not_available",
      reason: `Gateway proxy is not available on the ${plan.name} plan. Upgrade to Starter or higher to route traffic through Agent Prism.`,
      plan: plan.name,
      upgrade: upgradePrompt(tenant.plan, "gateway access")
    };
  }
  return { allowed: true };
}

function upgradePrompt(currentPlan, limitHit) {
  const next = currentPlan === "free" ? "starter" : currentPlan === "starter" ? "pro" : "enterprise";
  const nextPlan = PLANS[next];
  return {
    nextPlan: next,
    nextPlanName: nextPlan.name,
    limitHit,
    cta: `Upgrade to ${nextPlan.name} to get ${nextPlan.maxAgents === Infinity ? "unlimited" : nextPlan.maxAgents} agents and ${nextPlan.maxRunsPerMonth === Infinity ? "unlimited" : nextPlan.maxRunsPerMonth.toLocaleString()} runs/month.`,
    upgradeUrl: process.env.UPGRADE_URL || "https://agentprism.io/pricing"
  };
}
