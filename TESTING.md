# Guitar Pedalboard MVP Test Checklist

## Audio Input

- Before pressing `기타 연결하기`, no `AudioContext` or `getUserMedia` session should start.
- After browser permission is approved, audio input devices should appear in `입력 장치`.
- Changing the selected input device should stop the previous `MediaStream` tracks and reconnect with the new `deviceId`.
- Use headphones while testing to prevent speaker feedback.

## Audio Chain

- Default order should be `Noise Gate -> Compressor -> Drive -> EQ -> Delay -> Reverb`.
- `On` should remove or restore a pedal in the audio chain.
- `Bypass` should keep the pedal in place but pass the dry signal.
- Slider and switch changes should update parameters without rebuilding the whole chain.
- Input clipping is shown in the guitar connection panel.
- Master/output clipping is shown in the meter panel.
- Chain rebuild should fade master gain out for 20 ms, reconnect, then fade in for 20 ms.

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

## Browser And Performance

- Chrome and Edge should run the app without console errors.
- Safari should run the supported Web Audio path where `AudioWorklet` and input permissions are available.
- Long sessions should not keep old streams, object URLs, or effect nodes alive after stop/reconnect.
- Reordering pedals repeatedly should not produce loud pops or runaway feedback.

## Build Check

Run:

```bash
npm run build
```

The build must complete successfully before deploying.
