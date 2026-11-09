import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Participant, WheelSettings } from "./types";
import { POINTER_ANGLE, segmentIndexAtPointer } from "./engine";

export interface WheelHandle {
  spinTo: (rotation: number, duration: number) => Promise<void>;
  readonly rotation: number;
}

const TAU = Math.PI * 2;
const HIGHLIGHT_HALF_ANGLE = 0.28;

interface WheelProps {
  participants: Participant[];
  settings: WheelSettings;
  stoppedWinner?: Participant | null;
}

function paint(
  canvas: HTMLCanvasElement,
  participants: Participant[],
  settings: WheelSettings,
  rotation: number,
  stoppedWinner: Participant | null,
) {
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

    const pointerIndex = segmentIndexAtPointer(rotation, participants.length, POINTER_ANGLE);
    const hubRadius = Math.max(34, size * 0.11);
    const focusInnerRadius = hubRadius + 5;
    const focusOuterRadius = radius;
    context.save();
    context.beginPath();
    context.moveTo(
      center + focusInnerRadius,
      center,
    );
    context.lineTo(
      center + Math.cos(-HIGHLIGHT_HALF_ANGLE) * focusOuterRadius,
      center + Math.sin(-HIGHLIGHT_HALF_ANGLE) * focusOuterRadius,
    );
    context.arc(center, center, focusOuterRadius, -HIGHLIGHT_HALF_ANGLE, HIGHLIGHT_HALF_ANGLE);
    context.closePath();
    context.fillStyle = "rgba(255, 215, 112, 0.2)";
    context.fill();
    context.shadowColor = "#ffe08a";
    context.shadowBlur = 16;
    context.strokeStyle = "#ffe08a";
    context.lineWidth = Math.max(3, size * 0.009);
    context.stroke();
    context.restore();

    const highlightedName = (stoppedWinner ?? participants[pointerIndex]).name.trim();
    const labelFontSize = Math.max(10, Math.min(18, size * 0.034));
    const labelMaxWidth = radius * 0.58;
    context.save();
    context.font = `700 ${labelFontSize}px Inter, sans-serif`;
    const words = highlightedName.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > labelMaxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    const visibleLines = lines.slice(0, 3).map((text) => {
      let label = text;
      while (label.length > 1 && context.measureText(label).width > labelMaxWidth) {
        label = `${label.slice(0, -2)}…`;
      }
      return label;
    });
    if (lines.length > visibleLines.length && visibleLines.length > 0) {
      let lastLine = visibleLines[visibleLines.length - 1];
      while (lastLine.length > 1 && context.measureText(`${lastLine}…`).width > labelMaxWidth) {
        lastLine = `${lastLine.slice(0, -2)}…`;
      }
      visibleLines[visibleLines.length - 1] = `${lastLine}…`;
    }
    const lineHeight = labelFontSize * 1.15;
    const labelX = center + radius * 0.6;
    const labelY = center;
    context.fillStyle = "#30200d";
    context.strokeStyle = "#ffe6ac";
    context.lineWidth = Math.max(2, size * 0.004);
    context.shadowColor = "#fff0bd";
    context.shadowBlur = 5;
    context.textAlign = "center";
    context.textBaseline = "middle";
    visibleLines.forEach((text, index) => {
      const y = labelY + (index - (visibleLines.length - 1) / 2) * lineHeight;
      context.strokeText(text, labelX, y, labelMaxWidth);
      context.fillText(text, labelX, y, labelMaxWidth);
    });
    context.restore();
  }

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
