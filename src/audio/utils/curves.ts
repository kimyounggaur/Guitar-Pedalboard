export function createSoftClipCurve(samples = 2048, drive = 1): Float32Array {
  const curve = new Float32Array(samples);
  const amount = 1 + drive * 40;

  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }

  return curve;
}
