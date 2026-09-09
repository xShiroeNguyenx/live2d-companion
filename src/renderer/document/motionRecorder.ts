import { snapTime, useMotionUiStore } from './stores/motionUiStore';
import { motionsStore } from './stores/documentStores';
import { useSessionStore } from './stores/sessionStore';
import { runtimeRef } from './runtimeRef';
import { setKeyframe } from '../core/motion/MotionPlayback';

/**
 * Turns the model's current pose into keyframes at the playhead.
 *
 * Deliberately not part of the motion panel. The workflow this exists for is
 * "arm record, then go to the parameters tab and drag sliders" — so recording
 * has to keep working while the motion panel is unmounted. Reading the stores
 * directly makes it independent of what is on screen.
 */
export function recordFrameNow(): { ok: boolean; reason?: string } {
  const runtime = runtimeRef.current;
  const motionUi = useMotionUiStore.getState();
  const session = useSessionStore.getState();

  if (!runtime) return { ok: false, reason: 'no runtime' };
  if (!session.info) return { ok: false, reason: 'no model info' };
  if (!motionUi.activePath) return { ok: false, reason: 'no motion open' };

  const path = motionUi.activePath;
  const motions = motionsStore.getState();
  const document = motions.data.byPath[path];
  if (!document) return { ok: false, reason: 'motion not in store' };

  // Only pinned parameters are recorded. Everything else is either sitting at
  // its default or being driven by physics, and recording those would bury the
  // few curves the user actually performed under dozens of noisy ones.
  const pinned = session.pinned;
  if (pinned.size === 0) {
    return { ok: false, reason: 'no pinned parameters to record' };
  }

  const authored = runtime.getAuthoredValues();
  const at = snapTime(motionUi.time, document.fps, motionUi.snapToFrames);

  motions.edit(
    'Ghi keyframe từ slider',
    (draft) => {
      const target = draft.byPath[path];
      if (!target) return;

      for (const parameterIndex of pinned) {
        const parameter = session.info?.parameters[parameterIndex];
        if (!parameter) continue;

        let track = target.tracks.find(
          (candidate) => candidate.target === 'Parameter' && candidate.id === parameter.id
        );
        if (!track) {
          track = { target: 'Parameter', id: parameter.id, keyframes: [] };
          target.tracks.push(track);
        }
        setKeyframe(track, at, authored[parameterIndex] ?? parameter.default);
      }
      // Recording past the declared end extends the motion rather than being
      // silently dropped on save.
      target.duration = Math.max(target.duration, at);
    },
    // Group a burst of recorded frames into one undo entry per second, so
    // undoing a recording is a few presses rather than dozens.
    `motion:record:${path}:${Math.floor(at)}`
  );

  return { ok: true };
}
