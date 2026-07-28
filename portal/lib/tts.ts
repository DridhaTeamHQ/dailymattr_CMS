/**
 * Text-to-Speech (TTS) utilities for converting content summaries into playable audio tracks.
 */

/** Check if Web Speech API is supported in the browser */
export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Get list of available speech synthesis voices */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

/**
 * Reads text out loud using browser SpeechSynthesis API.
 */
export function speakSummary(
  text: string,
  options: {
    voice?: SpeechSynthesisVoice | null;
    rate?: number;
    pitch?: number;
    onBoundary?: (charIndex: number) => void;
    onEnd?: () => void;
    onError?: (err: any) => void;
  } = {}
): () => void {
  if (!isSpeechSupported() || !text.trim()) return () => {};

  window.speechSynthesis.cancel(); // Stop any previous playback

  const utterance = new SpeechSynthesisUtterance(text);
  if (options.voice) utterance.voice = options.voice;
  utterance.rate = options.rate ?? 1.0;
  utterance.pitch = options.pitch ?? 1.0;

  if (options.onBoundary) {
    utterance.onboundary = (e) => options.onBoundary?.(e.charIndex);
  }
  if (options.onEnd) {
    utterance.onend = () => options.onEnd?.();
  }
  if (options.onError) {
    utterance.onerror = (e) => options.onError?.(e);
  }

  window.speechSynthesis.speak(utterance);

  // Return cancel function
  return () => {
    window.speechSynthesis.cancel();
  };
}

/** Pause current speech synthesis */
export function pauseSummarySpeech() {
  if (isSpeechSupported()) {
    window.speechSynthesis.pause();
  }
}

/** Resume paused speech synthesis */
export function resumeSummarySpeech() {
  if (isSpeechSupported()) {
    window.speechSynthesis.resume();
  }
}

/** Check if speech synthesis is currently paused */
export function isSpeechPaused(): boolean {
  return isSpeechSupported() && window.speechSynthesis.paused;
}

/** Stop any active speech synthesis */
export function stopSummarySpeech() {
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Estimate spoken duration in seconds based on word count (~150 words per minute).
 */
export function estimateDurationSec(text: string, rate: number = 1.0): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const wpm = 150 * rate;
  return Math.max(3, Math.round((words / wpm) * 60));
}

/**
 * Synthesizes an Audio URL from text for saving into mediaUrl or playing.
 * Uses /api/tts route for high quality spoken MP3 audio.
 */
export async function generateAudioFromText(
  text: string,
  lang: string = "en"
): Promise<{ audioUrl: string; durationSec: number }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Summary text is empty. Type a summary first!");
  }

  const durationSec = estimateDurationSec(trimmed);
  const audioUrl = `/api/tts?text=${encodeURIComponent(trimmed)}&lang=${lang}`;

  return {
    audioUrl,
    durationSec,
  };
}

/** Convert AudioBuffer to WAV Blob */
function bufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const data = buffer.getChannelData(0);
  const dataSize = data.length * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < data.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
