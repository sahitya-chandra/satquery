// Configuration presence only: credentials and model access are verified on request.
export function modelConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const id = env.SATQUERY_AI_MODEL?.trim();
  const provider = id?.split(":")[0];
  const key = provider === "openai" ? "OPENAI_API_KEY"
    : provider === "anthropic" ? "ANTHROPIC_API_KEY"
    : provider === "google" ? "GOOGLE_GENERATIVE_AI_API_KEY" : null;
  return { configured: Boolean(id && /^(openai|anthropic|google):\S+$/.test(id) && key && env[key]?.trim()) };
}
