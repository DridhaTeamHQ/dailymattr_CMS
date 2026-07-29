"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, Settings2, Square } from "lucide-react";
import {
  generateAudioFromText,
  getAvailableVoices,
  isSpeechPaused,
  isSpeechSupported,
  pauseSummarySpeech,
  resumeSummarySpeech,
  speakSummary,
  stopSummarySpeech,
} from "@/lib/tts";

interface SummaryAudioConverterProps {
  summary: string;
  lang?: string;
  currentMediaUrl?: string | null;
  onAttachAudio?: (audioUrl: string, durationSec: number) => void;
}

export function SummaryAudioConverter({
  summary,
  lang = "en",
  currentMediaUrl,
  onAttachAudio,
}: SummaryAudioConverterProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [rate, setRate] = useState<number>(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const lastProcessedSummary = useRef<string>("");

  useEffect(() => {
    if (!isSpeechSupported()) return;

    const loadVoices = () => {
      const available = getAvailableVoices();
      setVoices(available);
      if (available.length === 0) return;
      const preferred =
        available.find(
          (v) => v.lang.startsWith(lang) || v.lang.startsWith("en")
        ) || available[0];
      // Decided against the current value rather than the one captured when
      // this closure was made. Browsers fire onvoiceschanged well after the
      // effect runs, and reading `selectedVoice` from the closure meant a voice
      // chosen in the meantime looked unset — so the picker reset itself.
      setSelectedVoice((current) => current ?? preferred);
    };

    loadVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      stopSummarySpeech();
    };
  }, [lang]);

  // Reset pause state when text changes
  useEffect(() => {
    stopSummarySpeech();
    setIsPlaying(false);
    setIsPaused(false);
  }, [summary]);

  // Auto-sync audio URL & duration whenever summary text changes
  useEffect(() => {
    if (!summary.trim() || !onAttachAudio) return;
    if (summary.trim() === lastProcessedSummary.current) return;

    const timer = setTimeout(async () => {
      try {
        lastProcessedSummary.current = summary.trim();
        const { audioUrl, durationSec } = await generateAudioFromText(summary, lang);
        onAttachAudio(audioUrl, durationSec);
      } catch {
        // Silently handle background audio generation errors
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [summary, lang, onAttachAudio]);

  const handleListenAudio = async () => {
    if (!summary.trim()) {
      setStatusMsg("Please enter a summary first!");
      setTimeout(() => setStatusMsg(null), 3000);
      return;
    }

    // 1. If currently playing -> PAUSE
    if (isPlaying) {
      pauseSummarySpeech();
      setIsPlaying(false);
      setIsPaused(true);
      return;
    }

    // 2. If currently paused -> RESUME from exact paused position
    if (isPaused && isSpeechPaused()) {
      resumeSummarySpeech();
      setIsPlaying(true);
      setIsPaused(false);
      return;
    }

    // 3. Otherwise start playback from current text
    setIsSyncing(true);
    setStatusMsg(null);

    try {
      if (onAttachAudio && summary.trim() !== lastProcessedSummary.current) {
        lastProcessedSummary.current = summary.trim();
        const { audioUrl, durationSec } = await generateAudioFromText(summary, lang);
        onAttachAudio(audioUrl, durationSec);
      }

      setIsPlaying(true);
      setIsPaused(false);

      speakSummary(summary, {
        voice: selectedVoice,
        rate,
        onEnd: () => {
          setIsPlaying(false);
          setIsPaused(false);
        },
        onError: () => {
          setIsPlaying(false);
          setIsPaused(false);
        },
      });
    } catch (err: any) {
      setStatusMsg(err?.message || "Error playing summary audio.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleStop = () => {
    stopSummarySpeech();
    setIsPlaying(false);
    setIsPaused(false);
  };

  return (
    <div className="mt-2.5 space-y-2 rounded-2xl border border-line bg-canvas/70 p-3 select-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Play / Pause / Resume Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleListenAudio}
            disabled={!summary.trim() || isSyncing}
            title={
              isPlaying
                ? "Pause audio"
                : isPaused
                ? "Resume audio from exact position"
                : "Listen to summary audio"
            }
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all disabled:opacity-40 ${
              isPlaying
                ? "bg-amber text-black shadow-md animate-pulse"
                : isPaused
                ? "bg-accent text-black shadow-md"
                : "bg-shell text-white hover:bg-shell/90 active:scale-95 shadow-sm"
            }`}
          >
            {isSyncing ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Preparing Audio…
              </>
            ) : isPlaying ? (
              <>
                <Pause size={15} className="fill-current" /> Pause Audio
              </>
            ) : isPaused ? (
              <>
                <Play size={15} className="fill-current" /> Resume Audio
              </>
            ) : (
              <>
                <Play size={15} className="fill-current" /> Listen Audio
              </>
            )}
          </button>

          {(isPlaying || isPaused) && (
            <button
              type="button"
              onClick={handleStop}
              className="flex items-center justify-center rounded-xl bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
              title="Stop & restart audio"
            >
              <Square size={13} className="fill-current" />
            </button>
          )}

          {summary.trim() && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-500">
              <Check size={13} /> Audio Ready
            </span>
          )}
        </div>

        {/* Voice Options Toggle */}
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-muted hover:text-ink transition-colors"
        >
          <Settings2 size={13} />
          <span>Voice Options</span>
        </button>
      </div>

      {/* Voice & Speed Settings Drawer */}
      {showSettings && (
        <div className="grid gap-3 pt-2.5 border-t border-line/60 sm:grid-cols-2 text-xs">
          <div>
            <label className="label mb-1 text-[10px]">Select Voice</label>
            <select
              className="field text-xs py-1.5"
              value={selectedVoice?.name || ""}
              onChange={(e) => {
                const v = voices.find((voice) => voice.name === e.target.value);
                if (v) setSelectedVoice(v);
              }}
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
              {voices.length === 0 && <option>Default System Voice</option>}
            </select>
          </div>

          <div>
            <label className="label mb-1 text-[10px]">Reading Speed ({rate}x)</label>
            <div className="flex items-center gap-2">
              {[0.8, 1.0, 1.25, 1.5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRate(r)}
                  className={`flex-1 rounded-lg py-1 text-[11px] font-bold border transition-colors ${
                    rate === r
                      ? "bg-accent text-black border-accent"
                      : "bg-card text-muted border-line hover:text-ink"
                  }`}
                >
                  {r}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Status Message */}
      {statusMsg && (
        <p className="text-[11px] font-semibold text-accent bg-accent/10 px-2.5 py-1 rounded-lg">
          {statusMsg}
        </p>
      )}
    </div>
  );
}
