import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';

export interface WaveformCanvasHandle {
  draw: (input: readonly number[], output: readonly number[]) => void;
  clear: () => void;
}

interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

interface WaveformPalette {
  background: string;
  guide: string;
  input: string;
  output: string;
}

const EMPTY_SIZE: CanvasSize = { width: 1, height: 1, dpr: 1 };

const WaveformCanvasImpl = forwardRef<WaveformCanvasHandle>(function WaveformCanvas(
  _props,
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef<CanvasSize>(EMPTY_SIZE);
  const paletteRef = useRef<WaveformPalette | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      draw: (input, output) => {
        const canvas = canvasRef.current;
        const context = contextRef.current;
        if (!canvas || !context) return;

        if (sizeRef.current.dpr !== getDevicePixelRatio()) {
          sizeRef.current = resizeCanvas(canvas, context);
        }

        paletteRef.current ??= readPalette(canvas);
        paintCanvas(context, sizeRef.current, paletteRef.current, input, output);
      },
      clear: () => {
        const canvas = canvasRef.current;
        const context = contextRef.current;
        if (!canvas || !context) return;

        paletteRef.current ??= readPalette(canvas);
        paintCanvas(context, sizeRef.current, paletteRef.current);
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return undefined;

    contextRef.current = context;

    const syncCanvas = () => {
      sizeRef.current = resizeCanvas(canvas, context);
      paletteRef.current = readPalette(canvas);
      paintCanvas(context, sizeRef.current, paletteRef.current);
    };

    syncCanvas();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncCanvas);
    resizeObserver?.observe(canvas);

    if (!resizeObserver) {
      window.addEventListener('resize', syncCanvas);
    }

    const themeObserver = new MutationObserver(() => {
      paletteRef.current = readPalette(canvas);
      paintCanvas(context, sizeRef.current, paletteRef.current);
    });
    const observerOptions: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    };
    themeObserver.observe(document.documentElement, observerOptions);
    if (document.body) themeObserver.observe(document.body, observerOptions);

    return () => {
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', syncCanvas);
      themeObserver.disconnect();
      contextRef.current = null;
    };
  }, []);

  return (
    <div className="waveform-panel">
      <span className="control-row">
        <span>Waveform</span>
        <output>In / Out</output>
      </span>
      <canvas
        ref={canvasRef}
        width={240}
        height={84}
        aria-label="입력 및 출력 오디오 파형"
        role="img"
      />
    </div>
  );
});

export const WaveformCanvas = memo(WaveformCanvasImpl);

function getDevicePixelRatio(): number {
  return Math.max(1, window.devicePixelRatio || 1);
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): CanvasSize {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, canvas.clientWidth || bounds.width);
  const height = Math.max(1, canvas.clientHeight || bounds.height);
  const dpr = getDevicePixelRatio();
  const pixelWidth = Math.max(1, Math.round(width * dpr));
  const pixelHeight = Math.max(1, Math.round(height * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height, dpr };
}

function readPalette(canvas: HTMLCanvasElement): WaveformPalette {
  const styles = window.getComputedStyle(canvas);
  const fallbackColor = styles.color || 'currentColor';

  return {
    background:
      styles.getPropertyValue('--panel-soft').trim() || styles.backgroundColor || 'transparent',
    guide: styles.getPropertyValue('--border').trim() || fallbackColor,
    input: styles.getPropertyValue('--accent').trim() || fallbackColor,
    output: styles.getPropertyValue('--danger').trim() || fallbackColor,
  };
}

function paintCanvas(
  context: CanvasRenderingContext2D,
  size: CanvasSize,
  palette: WaveformPalette,
  input: readonly number[] = [],
  output: readonly number[] = [],
): void {
  const { width, height, dpr } = size;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.background;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = palette.guide;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();
  drawWaveform(context, input, width, height, palette.input);
  drawWaveform(context, output, width, height, palette.output);
}

function drawWaveform(
  context: CanvasRenderingContext2D,
  data: readonly number[],
  width: number,
  height: number,
  color: string,
): void {
  if (data.length < 2) return;

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();

  for (let index = 0; index < data.length; index += 1) {
    const x = (index / (data.length - 1)) * width;
    const y = height / 2 - data[index] * (height * 0.42);

    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }

  context.stroke();
}
