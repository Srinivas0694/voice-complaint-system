'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';

/**
 * The signature element: the complaint's ACTUAL waveform, decoded from the WAV
 * with the Web Audio API rather than drawn from fake data. A complaint here is
 * a spoken thing, and this is the only view that shows it as one.
 *
 * Peaks are computed once and cached in state; the played portion is repainted
 * on each animation frame.
 */
export function Waveform({ src, durationMs }: { src: string; durationMs: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  // Decode once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        const raw = audio.getChannelData(0);

        const BUCKETS = 180;
        const step = Math.floor(raw.length / BUCKETS);
        const out: number[] = [];
        for (let i = 0; i < BUCKETS; i++) {
          let peak = 0;
          for (let j = 0; j < step; j++) {
            const v = Math.abs(raw[i * step + j] ?? 0);
            if (v > peak) peak = v;
          }
          out.push(peak);
        }
        const max = Math.max(...out, 0.01);
        if (!cancelled) setPeaks(out.map((p) => p / max));
        ctx.close();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  // Paint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const style = getComputedStyle(document.documentElement);
    const frost = style.getPropertyValue('--frost').trim();
    const line = style.getPropertyValue('--line').trim();

    const barW = w / peaks.length;
    peaks.forEach((p, i) => {
      const barH = Math.max(2, p * h * 0.9);
      ctx.fillStyle = i / peaks.length <= progress ? frost : line;
      ctx.fillRect(i * barW, (h - barH) / 2, Math.max(1, barW - 1), barH);
    });
  }, [peaks, progress]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    let raf = 0;
    const tick = () => {
      if (a.duration) setProgress(a.currentTime / a.duration);
      raf = requestAnimationFrame(tick);
    };
    if (playing) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  }

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = audioRef.current;
    const canvas = canvasRef.current;
    if (!a || !canvas || !a.duration) return;
    const rect = canvas.getBoundingClientRect();
    a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration;
    setProgress(a.currentTime / a.duration);
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={toggle}
        aria-label={playing ? 'Pause recording' : 'Play recording'}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full border hairline
                   text-frost transition-colors hover:bg-raised"
      >
        {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
      </button>

      <div className="min-w-0 flex-1">
        {failed ? (
          <p className="text-sm text-mist">Recording could not be loaded.</p>
        ) : peaks ? (
          <canvas
            ref={canvasRef}
            onClick={seek}
            className="h-14 w-full cursor-pointer"
            role="slider"
            aria-label="Seek within recording"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        ) : (
          <div className="h-14 animate-pulse rounded bg-raised" />
        )}
      </div>

      <span className="shrink-0 font-mono text-xs text-mist tabular-nums">
        {durationMs ? `${(durationMs / 1000).toFixed(1)}s` : ''}
      </span>

      <audio
        ref={audioRef}
        src={src}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        className="hidden"
      />
    </div>
  );
}
