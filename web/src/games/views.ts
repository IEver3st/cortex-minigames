// Game id → Svelte view. Kept apart from the logic registry so tests and the Lua catalog never
// import components.

import type { Component } from 'svelte';
import CircuitView from './circuit_route/View.svelte';
import MashView from './mash/View.svelte';
import PatternView from './pattern_rebuild/View.svelte';
import PinView from './pin_tension/View.svelte';
import PressureView from './pressure/View.svelte';
import PulseView from './pulse_sync/View.svelte';
import QteView from './qte/View.svelte';
import SequenceView from './sequence/View.svelte';
import SignalView from './signal_lock/View.svelte';
import TimingView from './timing/View.svelte';
import TraceView from './trace_path/View.svelte';
import TraceSweepView from './trace/View.svelte';
import WaveView from './wave_match/View.svelte';

export const VIEWS: Record<string, Component> = {
  timing: TimingView,
  sequence: SequenceView,
  pressure: PressureView,
  signal_lock: SignalView,
  circuit_route: CircuitView,
  pin_tension: PinView,
  wave_match: WaveView,
  trace_path: TraceView,
  pattern_rebuild: PatternView,
  pulse_sync: PulseView,
  mash: MashView,
  trace: TraceSweepView,
  qte: QteView,
};
