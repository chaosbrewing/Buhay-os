// Optional scene metadata for Replit workspace integrations. When the
// workspace's scene controls are enabled for this project, a viewer's click on
// a scene segment scopes their next chat request to that scene's source file.
// Fill one entry per SCENE_DURATIONS key in VideoTemplate.tsx only when a
// skill reference asks for it; otherwise leave the map empty. Scenes missing
// from the map still play and can be jumped to.
//
// Example:
//   export const SCENE_DETAILS: Record<string, SceneDetails> = {
//     open: { title: 'Intro', filePath: 'src/components/video/video_scenes/Scene1.tsx' },
//   };

export interface SceneDetails {
  title: string;
  filePath: string;
}

export const SCENE_DETAILS: Record<string, SceneDetails> = {
  opening: { title: 'Opening', filePath: 'src/components/video/FilmScenes.tsx' },
  today: { title: 'Today, gently', filePath: 'src/components/video/FilmScenes.tsx' },
  week: { title: 'See the shape', filePath: 'src/components/video/FilmScenes.tsx' },
  notes: { title: 'Notes and privacy', filePath: 'src/components/video/FilmScenes.tsx' },
  privacy: { title: 'Private by design', filePath: 'src/components/video/FilmScenes.tsx' },
};
