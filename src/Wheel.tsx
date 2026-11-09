  context.beginPath();
  context.arc(center, center, rimRadius, 0, TAU);
  context.strokeStyle = "#f0d27f";
  context.lineWidth = Math.max(2, size * 0.006);
  context.stroke();
  context.beginPath();
  context.arc(center, center, radius + 1, 0, TAU);
  context.strokeStyle = "#f3d996";
  context.lineWidth = Math.max(1.5, size * 0.004);
  context.stroke();

  const markerCount = 32;
  const markerRing = (radius + rimRadius) / 2;
  const markerRadius = Math.max(2, size * 0.008);
  for (let index = 0; index < markerCount; index += 1) {
    const angle = (index / markerCount) * TAU;
    const x = center + Math.cos(angle) * markerRing;
    const y = center + Math.sin(angle) * markerRing;
    context.beginPath();
    context.arc(x, y, markerRadius, 0, TAU);
    const markerGradient = context.createRadialGradient(
      x - markerRadius * 0.3,
      y - markerRadius * 0.35,
      markerRadius * 0.1,
      x,
      y,
      markerRadius,
    );
    markerGradient.addColorStop(0, "#fff5c3");
    markerGradient.addColorStop(0.48, "#edc75d");
    markerGradient.addColorStop(1, "#a95d19");
    context.fillStyle = markerGradient;
    context.shadowColor = "#f5c85f";
    context.shadowBlur = markerRadius * 1.8;
    context.fill();
  }
  context.restore();

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.strokeStyle = settings.borderColor;
  context.lineWidth = 5;
  context.stroke();
  context.beginPath();
  const hubRadius = Math.max(34, size * 0.11);
  context.arc(center, center, hubRadius, 0, TAU);
  context.fillStyle = "#111014";
  context.fill();
  context.strokeStyle = settings.borderColor;
  context.lineWidth = 3;
  context.stroke();
  if (participants.length === 0) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#c8c0b3";
    context.font = `600 ${Math.max(12, Math.min(15, size * 0.04))}px Inter, sans-serif`;
    context.fillText("No participants yet", center, center - size * 0.13);
    context.fillStyle = "#8f8788";
    context.font = `${Math.max(10, Math.min(12, size * 0.032))}px Inter, sans-serif`;
    context.fillText("Add names to get started", center, center + size * 0.13);
  }
}

export const Wheel = forwardRef<WheelHandle, WheelProps>(function Wheel({ participants, settings, stoppedWinner = null }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => paint(canvas, participants, settings, rotationRef.current, stoppedWinner);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [participants, settings, stoppedWinner]);

  useImperativeHandle(ref, () => ({
    get rotation() {
      return rotationRef.current;
    },
    spinTo(target, duration) {
      return new Promise((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) {
          resolve();
          return;
        }
        const start = rotationRef.current;
        const distance = target - start;
        const startedAt = performance.now();
        const frame = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / duration);
          const eased = 1 - (1 - progress) ** 4;
          rotationRef.current = start + distance * eased;
          paint(canvas, participants, settings, rotationRef.current, stoppedWinner);
          if (progress < 1) requestAnimationFrame(frame);
          else {
            rotationRef.current = ((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            paint(canvas, participants, settings, rotationRef.current, stoppedWinner);
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    },
  }), [participants, settings, stoppedWinner]);

  return <>
    <canvas ref={canvasRef} className="wheel-canvas" aria-label="Prize wheel" />
    <img className="wheel-center-logo" src={`${import.meta.env.BASE_URL}logo-center.png`} alt="" aria-hidden="true" />
  </>;
});