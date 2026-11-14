// Motion presets (UI spec section 4). The reduced-motion preference is read here and nowhere else.
import { animate, motion, useReducedMotion } from 'motion/react';
import type { Transition, Variants } from 'motion/react';
import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';

const EASE: Transition['ease'] = [0.2, 0, 0, 1];
export const STAGGER_STEP = 0.04;
export const STAGGER_CAP = 8;

type MotionDivProps = ComponentProps<typeof motion.div>;
/** Props spread onto a motion element: {...presets.page}. */
export type Enter = Required<Pick<MotionDivProps, 'initial' | 'animate' | 'exit' | 'transition'>>;
export type Reveal = Required<Pick<MotionDivProps, 'initial' | 'whileInView' | 'viewport' | 'transition'>>;
export type Press = Pick<MotionDivProps, 'whileTap'>;

export interface MotionPresets {
  reduced: boolean;
  page: Enter;
  list: Variants;
  listItem: Variants;
  collapse: Enter;
  dialog: Enter;
  sheetPhone: Enter;
  sheetDesktop: Enter;
  backdrop: Enter;
  press: Press;
  reveal: Reveal;
  toast: Enter;
}

export function buildPresets(reduced: boolean): MotionPresets {
  const fade = (duration: number): Enter => ({
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduced ? Math.min(duration, 0.12) : duration, ease: EASE },
  });

  if (reduced) {
    return {
      reduced,
      page: fade(0.12),
      list: { hidden: {}, show: {} },
      listItem: { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.12 } } },
      collapse: { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.12 } },
      dialog: fade(0.12),
      sheetPhone: fade(0.12),
      sheetDesktop: fade(0.12),
      backdrop: fade(0.12),
      press: {},
      reveal: { initial: { opacity: 1 }, whileInView: { opacity: 1 }, viewport: { once: true, amount: 0.2 }, transition: { duration: 0 } },
      toast: fade(0.12),
    };
  }

  return {
    reduced,
    page: {
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0 },
      transition: { duration: 0.2, ease: EASE },
    },
    list: { hidden: {}, show: {} },
    listItem: {
      hidden: { opacity: 0, y: 8 },
      show: (index: number = 0) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.2, ease: EASE, delay: Math.min(index, STAGGER_CAP - 1) * STAGGER_STEP },
      }),
    },
    collapse: {
      initial: false,
      animate: { opacity: 1, height: 'auto' },
      exit: { opacity: 0, height: 0, marginTop: 0, marginBottom: 0 },
      transition: { duration: 0.25, ease: EASE },
    },
    dialog: {
      initial: { opacity: 0, scale: 0.98 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.98 },
      transition: { duration: 0.18, ease: EASE },
    },
    sheetPhone: {
      initial: { y: '100%' },
      animate: { y: 0 },
      exit: { y: '100%' },
      transition: { duration: 0.22, ease: EASE },
    },
    sheetDesktop: {
      initial: { opacity: 0, x: 24 },
      animate: { opacity: 1, x: 0 },
      exit: { opacity: 0, x: 24 },
      transition: { duration: 0.18, ease: EASE },
    },
    backdrop: fade(0.18),
    press: { whileTap: { scale: 0.98 } },
    reveal: {
      initial: { opacity: 0, y: 8 },
      whileInView: { opacity: 1, y: 0 },
      viewport: { once: true, amount: 0.2 },
      transition: { duration: 0.24, ease: EASE },
    },
    toast: {
      initial: { opacity: 0, y: 12 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: 12 },
      transition: { duration: 0.18, ease: EASE },
    },
  };
}

const full = buildPresets(false);
const reducedPresets = buildPresets(true);

/** The single place that reads the user's reduced-motion preference. */
export function useMotionPresets(): MotionPresets {
  const reduced = useReducedMotion() ?? false;
  return reduced ? reducedPresets : full;
}

/** Counts a number up once, under 600 ms. Jumps straight to the value with reduced motion. */
export function useCountUp(target: number, durationMs = 550): number {
  const { reduced } = useMotionPresets();
  const [state, setState] = useState<{ value: number; settled: number | null }>({ value: 0, settled: null });
  const { settled } = state;

  useEffect(() => {
    if (reduced || settled === target) return;
    const controls = animate(settled ?? 0, target, {
      duration: Math.min(durationMs, 590) / 1000,
      ease: EASE,
      onUpdate: (latest) => setState((s) => ({ ...s, value: Math.round(latest) })),
      onComplete: () => setState({ value: target, settled: target }),
    });
    return () => controls.stop();
  }, [target, reduced, durationMs, settled]);

  if (reduced || settled === target) return target;
  return state.value;
}
