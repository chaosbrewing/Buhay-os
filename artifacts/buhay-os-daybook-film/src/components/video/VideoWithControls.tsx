import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat, Volume2, VolumeX } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';
import { SCENE_DETAILS } from './sceneMeta';

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function VideoWithControls() {
  const isIframed = typeof window !== 'undefined' && window.self !== window.top;
  const controls = useSceneControls(SCENE_DURATIONS);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sensorRef = useRef<HTMLDivElement>(null);
  const baseElapsed = useRef(0);

  useEffect(() => {
    baseElapsed.current = 0;
    setElapsed(0);
  }, [controls.tick]);
  useEffect(() => {
    if (controls.paused) return;
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed(baseElapsed.current + performance.now() - started), 80);
    return () => {
      clearInterval(timer);
      baseElapsed.current += performance.now() - started;
    };
  }, [controls.paused, controls.tick]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onOutside = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && sensorRef.current && !sensorRef.current.contains(event.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [collapsed, tapPinned]);
  useEffect(() => {
    if (!controls.paused) return;
    const animations = document.getAnimations().filter((animation) => animation.playState === 'running');
    animations.forEach((animation) => animation.pause());
    return () => animations.forEach((animation) => animation.play());
  }, [controls.paused]);

  const handleJump = useCallback((index: number) => {
    controls.jumpTo(index);
    window.parent.postMessage({
      type: 'REPLIT_VIDEO_SCENE_SELECTED',
      payload: {
        sceneIndex: index,
        sceneCount: SCENE_DURATIONS ? Object.keys(SCENE_DURATIONS).length : 0,
        sceneTitle: SCENE_DETAILS[controls.sceneKeys[index]]?.title ?? controls.sceneKeys[index],
        filePath: SCENE_DETAILS[controls.sceneKeys[index]]?.filePath ?? '',
        lineNumber: 1,
      },
    }, '*');
  }, [controls.jumpTo]);
  const handlePointerEnter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setHovering(true);
  }, []);
  const handlePointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') setHovering(false);
  }, []);
  const barVisible = !collapsed || hovering || tapPinned;
  if (!isIframed) return <VideoTemplate />;

  const progress = Math.min(1, elapsed / Math.max(1, controls.activeDuration));
  const totalElapsed = Math.min(controls.totalDuration, controls.activeStartTime + Math.min(elapsed, controls.activeDuration));
  return <div className="relative w-full h-screen">
    <VideoTemplate key={controls.mountKey} durations={controls.durations} paused={controls.paused} muted={controls.muted} onSceneChange={controls.onSceneChange} />
    <div ref={sensorRef} className="control-sensor" onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave} onPointerDown={(event) => { if (event.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}>
      <div className="flex-1" aria-hidden="true" />
      <div className={`controlbar ${barVisible ? '' : 'hidden'}`} aria-hidden={!barVisible}>
        <button className="control-button" aria-label={controls.paused ? 'Play' : 'Pause'} title={controls.paused ? 'Play' : 'Pause'} onClick={controls.togglePause}>{controls.paused ? <Play size="2.2vmin" /> : <Pause size="2.2vmin" />}</button>
        <button className="control-button" aria-label={controls.locked ? 'Unlock scene loop' : 'Loop current scene'} aria-pressed={controls.locked} title={controls.locked ? 'Loop current scene: on' : 'Loop current scene: off'} onClick={controls.toggleLock}><Repeat size="2.2vmin" /></button>
        <button className="control-button" aria-label={controls.muted ? 'Unmute audio' : 'Mute audio'} title={controls.muted ? 'Unmute' : 'Mute'} onClick={controls.toggleMuted}>{controls.muted ? <VolumeX size="2.2vmin" /> : <Volume2 size="2.2vmin" />}</button>
        <div className="w-px self-stretch bg-white/20" />
        <div className="segments">{controls.sceneKeys.map((key, index) => <button key={key} aria-label={`Jump to scene ${index + 1}`} aria-current={index === controls.activeIndex ? 'true' : undefined} onClick={() => handleJump(index)}><i style={{ width: index < controls.activeIndex ? '100%' : index === controls.activeIndex ? `${progress * 100}%` : '0%' }} /></button>)}</div>
        <span>{controls.activeIndex + 1}/{controls.sceneKeys.length}</span>
        <span className="min-w-[8ch] text-right tabular-nums">{formatTime(totalElapsed)} / {formatTime(controls.totalDuration)}</span>
        <button className="control-button" aria-label={collapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!collapsed} onClick={() => { setCollapsed((value) => !value); setHovering(false); setTapPinned(false); }}>{collapsed ? <ChevronUp size="2.5vmin" /> : <ChevronDown size="2.5vmin" />}</button>
      </div>
    </div>
  </div>;
}
