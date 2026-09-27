# Guitar Pedalboard Test Checklist

## Audio Input

- Before pressing `기타 연결하기`, no `AudioContext` or `getUserMedia` session should start.
- After browser permission is approved, audio input devices should appear in `입력 장치`.
- Changing the selected input device should stop the previous `MediaStream` tracks and reconnect with the new `deviceId`.
- Use headphones while testing to prevent speaker feedback.

## Audio Chain

- Default order should be `Noise Gate -> Compressor -> Auto Wah -> Drive -> Crunch -> Fuzz -> Graphic EQ -> EQ -> Cab -> Chorus -> Flanger -> Phaser -> Tremolo -> Delay -> Reverb`.
- `On/Off` should leave the pedal node in the chain and crossfade between its internal path and a buffered dry path.
- `enabled=false` means the pedal is powered off and visually dimmed; `bypassed=true` means it remains powered while passing dry signal.
- `Bypass` should keep the pedal in place, pass the dry signal, and preserve Delay/Reverb tails when `Trails` is enabled.
- Slider and switch changes should update parameters without rebuilding the whole chain.
- Input clipping is shown in the guitar connection panel.
- Master/output clipping is shown in the meter panel.
- A real topology change should fade master gain out for 8 ms, wait 12 ms before reconnecting, then fade in for 8 ms.
- A rebuild request with unchanged order and membership should not reconnect or fade the chain.

## Drag and Drop

- Dragging pedal handles left or right should reorder pedals.
- The audio chain should rebuild only in `onDragEnd`.
- Drag start, drag move, and drag cancel should not call `rebuildChain`.
- Sliders, knobs, switches, and preset controls should not start a drag gesture.
- Touch dragging should work on mobile.
- Keyboard dragging should work through the sortable keyboard sensor.
- Refreshing the page should preserve pedal order and parameter state through `localStorage`.

## Presets

- Saving a preset should store the current pedal order and all parameters.
- Loading a preset should restore order, enabled/bypass state, and parameters.
- `JSON Export` should download a JSON preset file.
- `JSON Import` should accept exported JSON and add or update user presets.
- All 40 factory presets should load without console errors and contain each schema-v10 pedal exactly once.
- A/B slots should keep session-only deep copies and switch without changing saved presets.

## Tempo, MIDI, And Recording

- Four taps should set a stable global BPM and update synced Delay/Tremolo pedals.
- Right-clicking a supported pedal's Bypass control should open `MIDI 학습` without toggling bypass.
- MIDI CC values 0–63 should turn bypass off and 64–127 should turn it on; Note On/Off should also work.
- MIDI mappings should survive reload through `guitar-pedalboard:midi`; unsupported browsers should not render MIDI controls.
- Recording should be unavailable until audio is running, then move through `idle -> recording -> ready`.
- Stopping a recording should create a downloadable `pedalboard-YYYYMMDD-HHmmss.webm` file.
- Starting another recording should revoke the previous Blob URL.
- Device switching, normal stop, and file changes should finalize recording; Panic, howl protection, and app unmount should abort and release recorder tracks.

## Tuner

- The tuner should be disconnected and display `--` until its toggle is enabled.
- Open-string E2 should settle within about ±3 cents without octave jumping.
- Switching to Drop D should make D2 the sixth-string target.
- Standard, Drop D, Half Step Down, and Open G should each show six target notes.
- The cent strip should use success within ±5 cents, warning within ±15 cents, and danger outside that range.
- Silence below the RMS threshold should clear the reading and avoid NSDF work.
- Rapidly toggling the tuner should not display readings from an older worklet session.
- Device changes and stop/start cycles should reconnect at most one tuner input edge.

## Browser And Performance

- Chrome and Edge should run the app without console errors.
- Safari should run the supported Web Audio path where `AudioWorklet` and input permissions are available.
- Long sessions should not keep old streams, object URLs, or effect nodes alive after stop/reconnect.
- Reordering pedals repeatedly should not produce loud pops or runaway feedback.

## Responsive, PWA, And Accessibility

- At 1280 px and wider, the board and sidebar should remain a two-column layout.
- At 768–1279 px, the sidebar should narrow and the pedal grid should use two columns.
- Below 768 px, pedals should use horizontal scroll snap and the fixed `입력 / 미터 / 프리셋` tab bar should expose only one panel at a time.
- Mobile controls, tab buttons, drag handles, and range inputs should have at least a 44×44 px hit area.
- The mobile latency warning should be dismissible and remain dismissed after reload.
- The production preview should serve `manifest.webmanifest`, `sw.js`, and both declared icon URLs under `/Guitar-Pedalboard/`.
- With the network offline after one online load, the cached app shell should load and show the offline input notice.
- Every range input should expose a unit-bearing `aria-valuetext`; every pedal card should be a labeled group.
- Keyboard-only operation should reach preset loading and Bypass controls and reorder a pedal through the sortable keyboard sensor.
- With `prefers-reduced-motion: reduce`, pedal drag transitions and blinking LED/overlay animations should be disabled.

## Build Check

Run:

```bash
npm run typecheck
npm run lint
npm run build
```

Run every `test:*` script in `package.json`. The build must complete successfully and each emitted JavaScript chunk must remain below 400 kB before deploying.
