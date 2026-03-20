import { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { convertToWav } from '../utils/audioUtils';
import type { TTSProvider } from '../types';

interface TTSState {
  provider: TTSProvider;
  isSpeaking: boolean;
}

export const useTTS = (apiKey: string | null) => {
  const [state, setState] = useState<TTSState>({ provider: 'browser', isSpeaking: false });
  const isFetchingRef = useRef(false);

  const setProvider = useCallback((provider: TTSProvider) => {
    setState(prev => ({ ...prev, provider }));
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim() || isFetchingRef.current) return;

    setState(prev => ({ ...prev, isSpeaking: true }));
    isFetchingRef.current = true;

    try {
      switch (state.provider) {
        case 'browser':
          await speakBrowser(text);
          break;
        case 'google':
          await speakGoogleCloud(text, apiKey);
          break;
        case 'gemini-flash':
          await speakGeminiFlash(text, apiKey);
          break;
        case 'gemini-pro':
          await speakGeminiPro(text, apiKey);
          break;
      }
    } catch (err) {
      console.error('TTS error:', err);
      // Fallback to browser
      await speakBrowser(text);
    } finally {
      isFetchingRef.current = false;
      setState(prev => ({ ...prev, isSpeaking: false }));
    }
  }, [state.provider, apiKey]);

  return { ...state, setProvider, speak };
};

// ── Provider implementations ────────────────────────────────

function speakBrowser(text: string): Promise<void> {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 0.9;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

async function speakGoogleCloud(text: string, apiKey: string | null): Promise<void> {
  if (!apiKey) throw new Error('API key required');
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'en-US', name: 'en-US-Journey-F' },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    }
  );
  if (!res.ok) throw new Error('Google TTS failed');
  const data = await res.json();
  await playBase64Audio(data.audioContent, 'audio/mp3');
}

async function speakGeminiFlash(text: string, apiKey: string | null): Promise<void> {
  if (!apiKey) throw new Error('API key required');
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  const session = await client.live.connect({
    model: 'models/gemini-2.0-flash-exp',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
    },
  });

  const audioParts: string[] = [];
  let audioMimeType = '';

  session.onmessage = (msg: any) => {
    const part = msg?.serverContent?.modelTurn?.parts?.[0];
    if (part?.inlineData) {
      audioParts.push(part.inlineData.data || '');
      if (!audioMimeType && part.inlineData.mimeType) audioMimeType = part.inlineData.mimeType;
    }
  };

  await session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }] });

  // Wait for audio
  await new Promise(resolve => setTimeout(resolve, 3000));
  session.close();

  if (audioParts.length > 0) {
    const wavBuffer = convertToWav(audioParts, audioMimeType || 'audio/pcm; rate=24000');
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    await playBlobAudio(blob);
  }
}

async function speakGeminiPro(text: string, apiKey: string | null): Promise<void> {
  if (!apiKey) throw new Error('API key required');
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });

  const response = await client.models.generateContentStream({
    model: 'models/gemini-2.5-pro-preview-tts',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
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
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    await playBlobAudio(blob);
  }
}

// ── Playback helpers ────────────────────────────────────────

async function playBase64Audio(b64: string, mimeType: string): Promise<void> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  await playBlobAudio(blob);
}

function playBlobAudio(blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Playback failed')); };
    audio.play();
  });
}
