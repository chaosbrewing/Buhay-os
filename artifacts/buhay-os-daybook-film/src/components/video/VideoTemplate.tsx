import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { VideoCanvas, type VideoAspectRatio, useVideoPlayer } from '@/lib/video';
import { Scene01, Scene02, Scene03, Scene04, Scene05 } from './FilmScenes';

export const SCENE_DURATIONS: Record<string, number> = {
  opening: 4500,
  today: 4500,
  week: 5000,
  notes: 5500,
  privacy: 4500,
};

export const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';
const SCENES: Record<string, React.ComponentType> = {
  opening: Scene01, today: Scene02, week: Scene03, notes: Scene04, privacy: Scene05,
};
const SCENE_START_SEC: Record<string, number> = (() => {
  const starts: Record<string, number> = {};
  let elapsed = 0;
  for (const [key, duration] of Object.entries(SCENE_DURATIONS)) {
    starts[key] = elapsed / 1000;
    elapsed += duration;
  }
  return starts;
})();

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  paused = false,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  paused?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSceneKeyRef = useRef<string | null>(null);
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const Scene = SCENES[baseSceneKey];

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.43;
    if (paused) {
      audio.pause();
      return;
    }
    if (lastSceneKeyRef.current !== currentSceneKey) {
      lastSceneKeyRef.current = currentSceneKey;
      const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - targetTime) > 0.18) audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [currentSceneKey, baseSceneKey, muted, paused]);

  return (
    <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} className="film" style={{ backgroundColor: '#f7f3e8' }}>
      <AnimatePresence mode="sync">
        {Scene && <Scene key={currentSceneKey} />}
      </AnimatePresence>
      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </VideoCanvas>
  );
}
