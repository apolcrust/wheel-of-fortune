import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Participant, WheelSettings } from "./types";

export interface WheelHandle {
  spinTo: (rotation: number, duration: number) => Promise<void>;
  readonly rotation: number;
}

interface WheelProps {
  participants: Participant[];
  settings: WheelSettings;
}

function paint(canvas: HTMLCanvasElement, participants: Participant[], settings: WheelSettings, rotation: number) {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = window.devicePixelRatio || 1;
  const size = bounds.width;
  const pixels = Math.round(size * ratio);
  if (canvas.width !== pixels || canvas.height !== pixels) {
    canvas.width = pixels;
    canvas.height = pixels;
  }
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas rendering is not supported by this browser.");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);
  const center = size / 2;
  const radius = center - 13;
  const slice = participants.length > 0 ? (Math.PI * 2) / participants.length : Math.PI * 2;

  if (participants.length === 0) {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = settings.background;
    context.fill();
  } else {
    participants.forEach((participant, index) => {
      const start = -Math.PI / 2 + rotation + index * slice;
      const end = start + slice;
      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, end);
      context.closePath();
      context.fillStyle = settings.colors[index % settings.colors.length] ?? "#8d382e";
      context.fill();
      context.strokeStyle = settings.borderColor;
      context.lineWidth = Math.max(0.7, size / 550);
      context.stroke();

      if (size * slice < 13) return;
      context.save();
      context.translate(center, center);
      context.rotate(start + slice / 2);
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillStyle = settings.textColor;
      const available = Math.max(5, Math.min(17, size * slice * 0.32));
      context.font = `700 ${available}px Inter, sans-serif`;
      let label = participant.name.trim();
      while (label.length > 3 && context.measureText(label).width > radius * 0.78) {
        label = `${label.slice(0, -2)}…`;
      }
      context.fillText(label, radius * 0.83, 0, radius * 0.78);
      context.restore();
    });
  }

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.strokeStyle = settings.borderColor;
  context.lineWidth = 5;
  context.stroke();
  context.beginPath();
  context.arc(center, center, Math.max(15, size * 0.055), 0, Math.PI * 2);
  context.fillStyle = settings.background;
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

export const Wheel = forwardRef<WheelHandle, WheelProps>(function Wheel({ participants, settings }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => paint(canvas, participants, settings, rotationRef.current);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [participants, settings]);

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
          paint(canvas, participants, settings, rotationRef.current);
          if (progress < 1) requestAnimationFrame(frame);
          else {
            rotationRef.current = ((target % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            paint(canvas, participants, settings, rotationRef.current);
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    },
  }), [participants, settings]);

  return <canvas ref={canvasRef} className="wheel-canvas" aria-label="Prize wheel" />;
});
