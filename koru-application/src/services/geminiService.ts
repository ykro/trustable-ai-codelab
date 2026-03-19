import { RACING_PHYSICS_KNOWLEDGE } from '../utils/coachingKnowledge';

/**
 * Gemini Cloud REST wrapper for lap analysis and coaching.
 */
export class GeminiService {
  private apiKey: string;

  constructor(apiKey: string) { this.apiKey = apiKey; }

  /** Generate coaching feedback with Flash */
  async generateCoaching(contextString: string): Promise<string> {
    const prompt = `You are a Race Engineer.
Reference the racing physics knowledge below to diagnose the user's telemetry.

${RACING_PHYSICS_KNOWLEDGE}

INPUT DATA:
${contextString}

TASK:
1. Identify the corner with the biggest time loss.
2. Explain the error using physics principles.

OUTPUT FORMAT:
**Directive:** [Short, actionable instruction]
### Analysis
[Detailed explanation using markdown]`;

    return this.callApi('gemini-2.0-flash', prompt);
  }

  /** Deep lap analysis with Pro + thinking */
  async analyzeLap(lapData: string): Promise<string> {
    const prompt = `You are an Elite Driver Coach analyzing a full lap.

${RACING_PHYSICS_KNOWLEDGE}

### EXAMPLES OF EXPERT ANALYSIS:
**Bad:** "You went too slow. Speed up." → Too generic.
**Good:** "In Turn 2, the telemetry shows a sudden throttle lift. Keep 10-20% 'maintenance throttle' to keep the rear planted. Physics: Lift-Off Oversteer (Weight Transfer Rule #2)."

### LAP DATA:
${lapData}

Analyze the lap. For each issue found:
**Directive:** [Max 10 words]
### Analysis
**Physics Diagnosis:** [explanation]
**Telemetry Evidence:** [data reference]
**Fix:** [actionable instruction]`;

    return this.callApi('gemini-2.0-flash', prompt);
  }

  private async callApi(model: string, prompt: string, generationConfig?: Record<string, unknown>): Promise<string> {
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
    };
    if (generationConfig) body.generationConfig = generationConfig;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || res.statusText);
      }
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (err) {
      console.error('GeminiService error:', err);
      return '';
    }
  }
}
