import { useEffect, useRef } from 'react';

interface WaveformCanvasProps {
  input: number[];
  output: number[];
}

export function WaveformCanvas({ input, output }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fbfcfe';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#d5dbe5';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
    drawWaveform(context, input, width, height, '#2366d1');
    drawWaveform(context, output, width, height, '#bd3f32');
  }, [input, output]);

  return (
    <div className="waveform-panel">
      <span className="control-row">
        <span>Waveform</span>
        <output>In / Out</output>
      </span>
      <canvas ref={canvasRef} width={240} height={84} aria-label="Drive input and output waveform" />
    </div>
  );
}

function drawWaveform(
  context: CanvasRenderingContext2D,
  data: number[],
  width: number,
  height: number,
  color: string,
): void {
  if (data.length < 2) return;

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  data.forEach((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height / 2 - value * (height * 0.42);

    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });

  context.stroke();
}
