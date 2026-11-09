
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Participant, WheelSettings } from "./types";
import { POINTER_ANGLE, segmentIndexAtPointer, wheelSpinProgress } from "./engine";

export interface WheelHandle {
  spinTo: (rotation: number, duration: number) => Promise<void>;
  readonly rotation: number;
}

const TAU = Math.PI * 2;
const HIGHLIGHT_HALF_ANGLE = Math.PI / 2;
const HIGHLIGHT_COUNT = 3;

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
  const radius = center - 31;
  const rimRadius = center - 13;
  const slice = participants.length > 0 ? TAU / participants.length : TAU;

  if (participants.length === 0) {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fillStyle = settings.background;
    context.fill();
  } else {
    participants.forEach((_, index) => {
      const start = -Math.PI / 2 + rotation + index * slice;
      const end = start + slice;

      context.beginPath();
      context.moveTo(center, center);
      context.arc(center, center, radius, start, end);
      context.closePath();

      context.fillStyle =
        settings.colors[index % settings.colors.length] ?? "#8d382e";
      context.fill();

      context.strokeStyle = settings.borderColor;
      context.lineWidth = Math.max(0.7, size / 550);
      context.stroke();

    });

    const hubRadius = Math.max(34, size * 0.11);
    const focusInnerRadius = hubRadius + 2;
    const highlightSlice = (HIGHLIGHT_HALF_ANGLE * 2) / HIGHLIGHT_COUNT;

    const highlights = Array.from(
      { length: HIGHLIGHT_COUNT },
      (_, index) => {
        const start = -HIGHLIGHT_HALF_ANGLE + index * highlightSlice;
        const end = start + highlightSlice;
        const offset = (start + end) / 2;

        const pointerIndex = segmentIndexAtPointer(
          rotation,
          participants.length,
          POINTER_ANGLE + offset,
        );

        return {
          offset,
          pointerIndex,
          start,
          end,
          name: (
            index === Math.floor(HIGHLIGHT_COUNT / 2) && stoppedWinner
              ? stoppedWinner
              : participants[pointerIndex]
          ).name.trim(),
        };
      },
    );

    // Draw the three highlighted sections in their normal slot colors.
    context.save();

    for (const highlight of highlights) {
      context.beginPath();
      context.moveTo(center + focusInnerRadius, center);

      context.lineTo(
        center + Math.cos(highlight.start) * radius,
        center + Math.sin(highlight.start) * radius,
      );

      context.arc(
        center,
        center,
        radius,
        highlight.start,
        highlight.end,
      );

      context.closePath();

      context.fillStyle =
        settings.colors[highlight.pointerIndex % settings.colors.length] ?? "#8d382e";
      context.shadowColor = "#e9aa31";
      context.shadowBlur = Math.max(9, size * 0.028);
      context.shadowOffsetX = 0;
      context.shadowOffsetY = Math.max(3, size * 0.008);

      context.fill();
    }

    // Draw glowing gold borders.
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;

    for (const highlight of highlights) {
      context.beginPath();
      context.moveTo(center + focusInnerRadius, center);

      context.lineTo(
        center + Math.cos(highlight.start) * radius,
        center + Math.sin(highlight.start) * radius,
      );

      context.arc(
        center,
        center,
        radius,
        highlight.start,
        highlight.end,
      );

      context.closePath();

      context.shadowColor = "#f3b93c";
      context.shadowBlur = Math.max(8, size * 0.026);
      context.strokeStyle = "#ffd83e";
      context.lineWidth = Math.max(3, size * 0.007);
      context.stroke();

      context.shadowBlur = 0;
      context.strokeStyle = "#fff4a0";
      context.lineWidth = Math.max(1, size * 0.0022);
      context.stroke();
    }

    context.restore();

    // Keep a live participant label visible in each highlighted wedge.
    for (const highlight of highlights) {
      const fontSize = Math.max(10, Math.min(20, size * 0.03));
      const lineHeight = fontSize * 1.12;
      const labelRadius = radius * 0.57;
      const maxWidth = Math.max(
        fontSize * 2,
        Math.min(
          radius * 0.48,
          2 * labelRadius * Math.sin(highlightSlice / 2) * 0.76,
        ),
      );
      context.save();
      context.beginPath();
      context.moveTo(center + focusInnerRadius, center);
      context.lineTo(
        center + Math.cos(highlight.start) * radius,
        center + Math.sin(highlight.start) * radius,
      );
      context.arc(center, center, radius, highlight.start, highlight.end);
      context.closePath();
      context.clip();
      context.translate(
        center + Math.cos(highlight.offset) * labelRadius,
        center + Math.sin(highlight.offset) * labelRadius,
      );
      context.rotate(highlight.offset);
      context.font = `700 ${fontSize}px Inter, sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";

      const lines: string[] = [];
      let line = "";
      const words = highlight.name.split(/\s+/).flatMap((word) => {
        const chunks: string[] = [];
        let chunk = "";
        for (const character of word) {
          if (chunk && context.measureText(chunk + character).width > maxWidth) {
            chunks.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        }
        if (chunk) chunks.push(chunk);
        return chunks;
      });

      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (line && context.measureText(next).width > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      if (line) lines.push(line);

      const maxLines = Math.max(
        1,
        Math.min(5, Math.floor((radius * 0.52) / lineHeight)),
      );
      const visibleLines = lines.slice(0, maxLines);
      if (lines.length > visibleLines.length && visibleLines.length > 0) {
        const lastIndex = visibleLines.length - 1;
        let last = visibleLines[lastIndex];
        while (
          last.length > 1 &&
          context.measureText(`${last}…`).width > maxWidth
        ) {
          last = last.slice(0, -1);
        }
        visibleLines[lastIndex] = `${last}…`;
      }

      context.fillStyle = settings.textColor;
      context.shadowColor = "#1a0b00";
      context.shadowBlur = 4;
      context.lineJoin = "round";
      context.strokeStyle = "#25170a";
      context.lineWidth = Math.max(2, fontSize * 0.18);
      visibleLines.forEach((text, index) => {
        const y = (index - (visibleLines.length - 1) / 2) * lineHeight;
        context.strokeText(text, 0, y, maxWidth);
        context.fillText(text, 0, y, maxWidth);
      });
      context.restore();
    }

    // Draw the regular segment labels when there is room for them.
    if (size * slice >= 40) {
      participants.forEach((participant, index) => {
        const start = -Math.PI / 2 + rotation + index * slice;
        context.save();
        context.translate(center, center);
        context.rotate(start + slice / 2);
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.fillStyle = settings.textColor;

        const available = Math.max(5, Math.min(17, size * slice * 0.32));
        context.font = `700 ${available}px Inter, sans-serif`;

        let label = participant.name.trim();

        while (
          label.length > 3 &&
          context.measureText(label).width > radius * 0.78
        ) {
          label = `${label.slice(0, -2)}…`;
        }

        context.fillText(label, radius * 0.83, 0, radius * 0.78);
        context.restore();
      });
    }

  }

  // Draw the outer metallic rim.
  context.save();
  context.beginPath();
  context.arc(center, center, rimRadius, 0, TAU);
  context.arc(center, center, radius, 0, TAU, true);
  context.closePath();

  const rimGradient = context.createRadialGradient(
    center,
    center,
    radius,
    center,
    center,
    rimRadius,
  );

  rimGradient.addColorStop(0, "#e5c27c");
  rimGradient.addColorStop(0.13, "#6e4a25");
  rimGradient.addColorStop(0.48, "#241b19");
  rimGradient.addColorStop(0.78, "#4d2e1b");
  rimGradient.addColorStop(1, "#e5c27c");

  context.fillStyle = rimGradient;
  context.shadowColor = "#000";
  context.shadowBlur = Math.max(8, size * 0.025);
  context.fill();

  context.shadowBlur = 0;

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

  // Draw the gold bulbs around the wheel.
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

  // Draw the center hub.
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

  context.beginPath();
  context.arc(center, center, hubRadius * 0.86, 0, TAU);
  context.strokeStyle = "#e5c27c";
  context.lineWidth = Math.max(1, size * 0.002);
  context.stroke();

  if (participants.length === 0) {
    context.textAlign = "center";
    context.textBaseline = "middle";

    context.fillStyle = "#c8c0b3";
    context.font = `600 ${Math.max(12, Math.min(15, size * 0.04))}px Inter, sans-serif`;

    context.fillText(
      "No participants yet",
      center,
      center - size * 0.13,
    );

    context.fillStyle = "#8f8788";
    context.font = `${Math.max(10, Math.min(12, size * 0.032))}px Inter, sans-serif`;

    context.fillText(
      "Add names to get started",
      center,
      center + size * 0.13,
    );
  }
}

export const Wheel = forwardRef<WheelHandle, WheelProps>(
  function Wheel(
    { participants, settings, stoppedWinner = null },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rotationRef = useRef(0);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const render = () =>
        paint(
          canvas,
          participants,
          settings,
          rotationRef.current,
          stoppedWinner,
        );

      render();

      const observer = new ResizeObserver(render);
      observer.observe(canvas);

      return () => observer.disconnect();
    }, [participants, settings, stoppedWinner]);

    useImperativeHandle(
      ref,
      () => ({
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
              const progress = Math.min(
                1,
                (now - startedAt) / duration,
              );

              const eased = wheelSpinProgress(progress);

              rotationRef.current = start + distance * eased;

              paint(
                canvas,
                participants,
                settings,
                rotationRef.current,
                stoppedWinner,
              );

              if (progress < 1) {
                requestAnimationFrame(frame);
              } else {
                rotationRef.current =
                  ((target % (Math.PI * 2)) + Math.PI * 2) %
                  (Math.PI * 2);

                paint(
                  canvas,
                  participants,
                  settings,
                  rotationRef.current,
                  stoppedWinner,
                );

                resolve();
              }
            };

            requestAnimationFrame(frame);
          });
        },
      }),
      [participants, settings, stoppedWinner],
    );

    return (
      <>
        <canvas
          ref={canvasRef}
          className="wheel-canvas"
          aria-label="Prize wheel"
        />

        <img
          className="wheel-center-logo"
          src={`${import.meta.env.BASE_URL}logo-center.png`}
          alt=""
          aria-hidden="true"
        />
      </>
    );
  },
);
