"use client";

import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Heart,
  MoreHorizontal,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { ContentItem } from "@/lib/types";
import { isPlayableAudio, mediaBlocker } from "@/lib/media";
import {
  estimateDurationSec,
  isSpeechSupported,
  pauseSummarySpeech,
  resumeSummarySpeech,
  speakSummary,
  stopSummarySpeech,
} from "@/lib/tts";

const fmtDur = (sec: number) => {
  if (isNaN(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
};

export function TraxAudioPlayer({
  item,
  author,
  onClose,
  onNext,
  onPrevious,
}: {
  item: ContentItem;
  author?: string;
  onClose?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Determine if item has a valid, reachable media URL file
  const hasDirectMedia =
    isPlayableAudio(item.mediaUrl) && !mediaBlocker("trax", item.mediaUrl);

  const textToSynthesize =
    item.summary || item.title || "DailyMattr Trax Audio Explainer";
  const estimatedSec = estimateDurationSec(textToSynthesize);

  // Derived audio URL for native HTML5 audio playback
  const audioUrl = hasDirectMedia
    ? item.mediaUrl!
    : `/api/tts?id=${encodeURIComponent(item.id)}&text=${encodeURIComponent(textToSynthesize)}&lang=${item.language || "en"}`;

  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(
    hasDirectMedia && item.durationSec ? item.durationSec : estimatedSec
  );

  const [liked, setLiked] = useState(false);

  // Single unified useEffect: Handles HTML5 Audio listeners & track playback
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(true);

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (onNext) {
        onNext();
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("loadeddata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    audio.load();
    audio
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {});

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("loadeddata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [item.id, audioUrl, onNext]);

  const handleClose = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    stopSummarySpeech();
    onClose?.();
  };

  // Toggle Play / Pause: Directly controls HTML5 Audio Element for exact millisecond pause/resume!
  const togglePlay = () => {
    const audio = audioRef.current;
    if (audio) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => {});
      }
      return;
    }

    // Speech Synthesis fallback toggle
    if (isSpeechSupported() && item.summary) {
      if (isPlaying) {
        pauseSummarySpeech();
        setIsPlaying(false);
      } else {
        resumeSummarySpeech();
        setIsPlaying(true);
      }
    }
  };

  // Timeline Progress Slider Scrubbing: Exact millisecond seeking!
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex h-full w-full flex-col justify-between bg-gradient-to-b from-slate-950 via-black to-slate-950 p-6 text-white overflow-y-auto select-none">
      {/* Hidden Native HTML5 Audio Element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          autoPlay
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Top Header */}
      <div className="flex items-center justify-between text-xs text-white/50 tracking-wider">
        <button
          type="button"
          onClick={handleClose}
          className="p-1 text-white/70 hover:text-white transition-colors"
        >
          <ChevronDown size={20} />
        </button>
        <div className="text-center font-bold uppercase text-[10px] tracking-widest text-white/60">
          Playing from Trax Audio
        </div>
        <button type="button" className="p-1 text-white/70 hover:text-white">
          <MoreHorizontal size={18} />
        </button>
      </div>

      {/* Album Artwork Cover */}
      <div className="my-auto flex justify-center py-4">
        <div className="relative aspect-square w-52 sm:w-60 md:w-64 overflow-hidden rounded-3xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
          {item.coverUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.coverUrl}
              alt={item.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-indigo-950 via-slate-900 to-black text-accent">
              <AudioLines size={48} />
              <span className="text-xs font-semibold text-white/60">
                DailyMattr Trax
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Track Title & Like Button */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold text-white leading-tight">
              {item.title || "Untitled Trax"}
            </h3>
            <p className="truncate text-xs font-medium text-white/60 mt-1">
              {author || "DailyMattr Audio Explainer"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLiked(!liked)}
            className={`p-1.5 transition-colors ${
              liked ? "text-rose fill-rose" : "text-white/40 hover:text-white"
            }`}
          >
            <Heart size={22} className={liked ? "fill-rose text-rose" : ""} />
          </button>
        </div>

        {/* Audio Progress / Scrub Bar */}
        <div className="space-y-1.5">
          <div className="relative flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 10}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[#d8f231] focus:outline-none"
              style={{
                background: `linear-gradient(to right, #d8f231 ${progressPercent}%, rgba(255,255,255,0.15) ${progressPercent}%)`,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-mono text-white/45">
            <span>{fmtDur(currentTime)}</span>
            <span>{fmtDur(duration)}</span>
          </div>
        </div>

        {/* Media Controls Bar */}
        <div className="flex items-center justify-center gap-8 pt-1">
          <button
            type="button"
            onClick={() => {
              if (currentTime > 3) {
                setCurrentTime(0);
                if (audioRef.current) audioRef.current.currentTime = 0;
              } else if (onPrevious) {
                onPrevious();
              } else {
                setCurrentTime(0);
                if (audioRef.current) audioRef.current.currentTime = 0;
              }
            }}
            className="text-white/80 hover:text-white transition-colors p-2 active:scale-90"
            title="Previous Track"
          >
            <SkipBack size={24} className="fill-white/80 hover:fill-white" />
          </button>

          {/* Main Play/Pause Button */}
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[#d8f231] text-black shadow-lg hover:scale-105 active:scale-95 transition-all"
          >
            {isPlaying ? (
              <Pause size={22} className="fill-black" />
            ) : (
              <Play size={22} className="ml-0.5 fill-black" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              if (onNext) {
                onNext();
              } else {
                setCurrentTime(duration);
                if (audioRef.current) audioRef.current.currentTime = duration;
              }
            }}
            className="text-white/80 hover:text-white transition-colors p-2 active:scale-90"
            title="Next Track"
          >
            <SkipForward size={24} className="fill-white/80 hover:fill-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
