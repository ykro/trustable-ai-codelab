import { useState, useCallback } from 'react';
import { RACING_PHYSICS_KNOWLEDGE } from '../utils/coachingKnowledge';
import { convertToWav } from '../utils/audioUtils';
import { GoogleGenAI, Modality } from '@google/genai';
import type { CloudModel } from '../types';

interface CloudStatus {
  state: 'idle' | 'loading' | 'error' | 'success';
  error?: string;
  hasKey: boolean;
}

export const useGeminiCloud = () => {
  const [apiKey, setAutoApiKey] = useState<string | null>(() =>
    localStorage.getItem('gemini_api_key') || null
  );

  const [status, setStatus] = useState<CloudStatus>({
    state: 'idle',
    hasKey: !!apiKey,
  });

  const setApiKey = useCallback((key: string) => {
    if (key) {
      localStorage.setItem('gemini_api_key', key);
      setAutoApiKey(key);
      setStatus(prev => ({ ...prev, hasKey: true }));
    } else {
      localStorage.removeItem('gemini_api_key');
      setAutoApiKey(null);
      setStatus(prev => ({ ...prev, hasKey: false }));
    }
  }, []);

  const generateFeedback = useCallback(
    async (model: CloudModel, contextString: string) => {
      if (!apiKey) {
        setStatus({ state: 'error', hasKey: false, error: 'API Key missing' });
        return '';
      }

      setStatus(prev => ({ ...prev, state: 'loading', error: undefined }));

      try {
        const modelName = model === 'pro' ? 'gemini-2.0-flash' : 'gemini-2.0-flash';

        const prompt = model === 'pro'
          ? `You are an Elite Driver Coach.
${RACING_PHYSICS_KNOWLEDGE}

### EXAMPLES:
**Bad:** "You went too fast. Slow down." → Too generic.
**Good:** "In Turn 2, telemetry shows a sudden lift. Keep 10-20% 'maintenance throttle'. Physics: Lift-Off Oversteer."

Analyze:
${contextString}

**Directive:** [Max 10 words]
### Analysis
[Detailed markdown with **Physics Diagnosis**, **Telemetry**, **Fix**]`
          : `You are a Race Engineer.
${RACING_PHYSICS_KNOWLEDGE}

INPUT: ${contextString}

TASK: Identify the biggest time loss. Explain the error.

**Directive:** [Short instruction]
### Analysis
[Explanation]`;

        const body: Record<string, unknown> = {
          contents: [{ parts: [{ text: prompt }] }],
        };
        // Note: thinkingConfig only supported by gemini-2.5-pro models

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error?.message || res.statusText);
        }

        const data = await res.json();
        setStatus(prev => ({ ...prev, state: 'success' }));
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } catch (err: unknown) {
        console.error('Gemini Cloud failed:', err);
        setStatus(prev => ({ ...prev, state: 'error', error: (err as Error).message }));
        return '';
      }
    },
    [apiKey]
  );

  const generateAudio = useCallback(async (text: string, voiceName = 'Zephyr'): Promise<Blob | null> => {
    if (!apiKey) return null;
    try {
      const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });

      const response = await client.models.generateContentStream({
        model: 'models/gemini-2.5-pro-preview-tts',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
        contents: [{ role: 'user', parts: [{ text: `Read aloud verbatim: "${text}"` }] }],
      });

      const audioParts: string[] = [];
      let audioMimeType = '';

      for await (const chunk of response) {
        const inlineData = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (inlineData) {
          audioParts.push(inlineData.data || '');
          if (!audioMimeType && inlineData.mimeType) audioMimeType = inlineData.mimeType;
        }
      }

      if (audioParts.length > 0) {
        const wavBuffer = convertToWav(audioParts, audioMimeType || 'audio/pcm; rate=24000');
        return new Blob([wavBuffer], { type: 'audio/wav' });
      }
      return null;
    } catch (e) {
      console.error('Audio gen failed:', e);
      return null;
    }
  }, [apiKey]);

  return { status, generateFeedback, generateAudio, setApiKey, apiKey };
};
