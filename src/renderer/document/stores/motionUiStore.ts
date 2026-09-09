import { create } from 'zustand';
import { initialPlayback, type PlaybackState } from '../../core/motion/MotionPlayback';

export interface SelectedKeyframe {
  trackIndex: number;
  keyframeIndex: number;
}

interface MotionUiState extends PlaybackState {
  /** Path of the motion being edited, or null when none is open. */
  activePath: string | null;
  /** Track shown in the curve editor; null shows the dope sheet only. */
  expandedTrack: number | null;
  selection: SelectedKeyframe[];
  /** Recording turns slider moves into keyframes at the playhead. */
  recording: boolean;
  /** Snap the playhead and keyframe drags to the motion's frame grid. */
  snapToFrames: boolean;

  openMotion(path: string | null): void;
  setTime(time: number): void;
  setPlaying(playing: boolean): void;
  setLoop(loop: boolean): void;
  setSpeed(speed: number): void;
  setRecording(recording: boolean): void;
  setSnapToFrames(snap: boolean): void;
  expandTrack(trackIndex: number | null): void;
  select(selection: SelectedKeyframe[]): void;
  toggleSelected(entry: SelectedKeyframe, additive: boolean): void;
  clearSelection(): void;
}

/**
 * Timeline UI state: which motion is open, where the playhead is, what is
 * selected.
 *
 * Playback lives here rather than in the runtime because the timeline owns the
 * playhead — scrubbing has to show a frame instantly, and the runtime only ever
 * receives the already-sampled instant.
 */
export const useMotionUiStore = create<MotionUiState>((set) => ({
  ...initialPlayback,
  activePath: null,
  expandedTrack: null,
  selection: [],
  recording: false,
  snapToFrames: true,

  openMotion: (activePath) =>
    // Opening a different motion invalidates everything that referred to the
    // previous one by index.
    set({
      activePath,
      time: 0,
      playing: false,
      recording: false,
      expandedTrack: null,
      selection: []
    }),

  setTime: (time) => set({ time: Math.max(0, time) }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  setSpeed: (speed) => set({ speed }),

  setRecording: (recording) =>
    // Recording while paused would write every slider move to the same instant,
    // so arming it starts playback.
    set(recording ? { recording, playing: true } : { recording }),

  setSnapToFrames: (snapToFrames) => set({ snapToFrames }),
  expandTrack: (expandedTrack) => set({ expandedTrack, selection: [] }),
  select: (selection) => set({ selection }),

  toggleSelected: (entry, additive) =>
    set((state) => {
      const exists = state.selection.some(
        (candidate) =>
          candidate.trackIndex === entry.trackIndex &&
          candidate.keyframeIndex === entry.keyframeIndex
      );
      if (!additive) return { selection: exists ? [] : [entry] };
      return {
        selection: exists
          ? state.selection.filter(
              (candidate) =>
                candidate.trackIndex !== entry.trackIndex ||
                candidate.keyframeIndex !== entry.keyframeIndex
            )
          : [...state.selection, entry]
      };
    }),

  clearSelection: () => set({ selection: [] })
}));

/** Rounds a time to the motion's frame grid. */
export function snapTime(time: number, fps: number, enabled: boolean): number {
  if (!enabled || fps <= 0) return Math.max(0, time);
  return Math.max(0, Math.round(time * fps) / fps);
}
