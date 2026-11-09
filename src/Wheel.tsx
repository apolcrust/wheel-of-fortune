import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Participant, WheelSettings } from "./types";
import {
  WINNER_HIGHLIGHT,
  highlightBounds,
  highlightedSegmentIndices,
  wheelSpinProgress,
  winnerIndexAtRotation,
} from "./engine";

export interface WheelHandle {
  /**
   * Spins the wheel to `rotation` over `duration` ms. `roster` is the exact list the
   * wheel is laid out with (defaults to the participants currently shown). Resolves,
   * once the wheel has fully stopped, with the index in `roster` of the segment that
   * is under the pointer at the final rotation. That index is the winner.
   */
  spinTo: (rotation: number, duration: number, roster?: Participant[]) => Promise<number>;
  readonly rotation: number;
}

const TAU = Math.PI * 2;

// Triangle look. The scale pulls each tile slightly in on itself so the three tiles
// read as separate raised pieces; the inset keeps label text clear of the borders.
const TRIANGLE_SCALE = 0.93;
const LABEL_INSET = 0.86;
const LABEL_MAX_LINES = 2;
const ARC_STEPS = 24;

interface WheelProps {
  participants: Participant[];
  settings: WheelSettings;
  stoppedWinner?: Participant | null;
}

interface Point {
  x: number;
  y: number;
}

interface TriangleShape {
  apex: Point;
  arcCenter: Point;
  arcRadius: number;
  start: number;
  end: number;
  centroid: Point;
  /** Direction of the triangle: from its apex through its centre. */
  axis: number;
  top: number;
  bottom: number;
  /** Label region in a frame centred on the centroid with x along the axis. */
  labelRegion: Point[];
}

function polygonCentroid(points: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area /= 2;
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Builds one highlighted triangle (apex at the hub, curved base on the rim). */
function buildTriangle(
  center: number,
  radius: number,
  apexOffset: number,
  start: number,
  end: number,
): TriangleShape {
  const apex = { x: center + apexOffset, y: center };
  const outline: Point[] = [apex];
  for (let step = 0; step <= ARC_STEPS; step += 1) {
    const angle = start + ((end - start) * step) / ARC_STEPS;
    outline.push({ x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius });
  }

  const centroid = polygonCentroid(outline);
  const shrink = (point: Point, factor: number): Point => ({
    x: centroid.x + (point.x - centroid.x) * factor,
    y: centroid.y + (point.y - centroid.y) * factor,
  });
  const axis = Math.atan2(centroid.y - apex.y, centroid.x - apex.x);
  const cos = Math.cos(axis);
  const sin = Math.sin(axis);
  const labelRegion = outline.map((point) => {
    const dx = (point.x - centroid.x) * TRIANGLE_SCALE * LABEL_INSET;
    const dy = (point.y - centroid.y) * TRIANGLE_SCALE * LABEL_INSET;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  });
  const scaled = outline.map((point) => shrink(point, TRIANGLE_SCALE));

  return {
    apex: shrink(apex, TRIANGLE_SCALE),
    arcCenter: shrink({ x: center, y: center }, TRIANGLE_SCALE),
    arcRadius: radius * TRIANGLE_SCALE,
    start,
    end,
    centroid,
    axis,
    top: Math.min(...scaled.map((point) => point.y)),
    bottom: Math.max(...scaled.map((point) => point.y)),
    labelRegion,
  };
}

function traceTriangle(context: CanvasRenderingContext2D, shape: TriangleShape) {
  context.beginPath();
  context.moveTo(shape.apex.x, shape.apex.y);
  context.arc(shape.arcCenter.x, shape.arcCenter.y, shape.arcRadius, shape.start, shape.end);
  context.closePath();
}

/** Horizontal extent of a convex polygon at height y, or null if it does not reach y. */
function spanAt(polygon: Point[], y: number): [number, number] | null {
  let low = Infinity;
  let high = -Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    const x = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
    low = Math.min(low, x);
    high = Math.max(high, x);
  }
  return low <= high ? [low, high] : null;
}

/** Widest text block of the given height, centred on the origin, that fits the region. */
function availableWidth(region: Point[], height: number): number {
  const upper = spanAt(region, -height / 2);
  const lower = spanAt(region, height / 2);
  if (!upper || !lower) return 0;
  const half = Math.min(-upper[0], upper[1], -lower[0], lower[1]);
  return half > 0 ? half * 2 : 0;
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean).flatMap((word) => {
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

  const lines: string[] = [];
  let line = "";
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
  return lines;
}

function labelMetrics(fontSize: number, lineCount: number) {
  const lineHeight = fontSize * 1.15;
  return { lineHeight, blockHeight: lineCount * lineHeight + fontSize * 0.3 };
}

/** Lays the name out inside the region at the current font, or null if it does not fit. */
function fitLabel(
  context: CanvasRenderingContext2D,
  name: string,
  region: Point[],
  fontSize: number,
): string[] | null {
  for (let lineCount = 1; lineCount <= LABEL_MAX_LINES; lineCount += 1) {
    const width = availableWidth(region, labelMetrics(fontSize, lineCount).blockHeight);
    if (width <= 0) continue;
    const lines = wrapText(context, name, width);
    if (lines.length <= lineCount) return lines;
  }
  return null;
}

/** Last resort for very long names: wrap, then ellipsise the final visible line. */
function truncateLabel(
  context: CanvasRenderingContext2D,
  name: string,
  region: Point[],
  fontSize: number,
): string[] {
  const width = availableWidth(region, labelMetrics(fontSize, LABEL_MAX_LINES).blockHeight);
  if (width <= 0) return [];
  const lines = wrapText(context, name, width);
  if (lines.length <= LABEL_MAX_LINES) return lines;
  const visible = lines.slice(0, LABEL_MAX_LINES);
  let last = visible[LABEL_MAX_LINES - 1];
  while (last.length > 1 && context.measureText(`${last}\u2026`).width > width) {
    last = last.slice(0, -1);
  }
  visible[LABEL_MAX_LINES - 1] = `${last}\u2026`;
  return visible;
}

/**
 * Draws the three raised selection triangles and their names. Everything here is derived
 * from the same rotation and roster as the wheel segments, so the names always belong to
 * the segments actually under each triangle, and the middle triangle is the winner.
 */
function drawHighlights(
  context: CanvasRenderingContext2D,
  participants: Participant[],
  settings: WheelSettings,
  rotation: number,
  size: number,
  center: number,
  radius: number,
  hubRadius: number,
  winnerNameOverride: string | null,
) {
  const bounds = highlightBounds();
  const segments = highlightedSegmentIndices(rotation, participants.length);
  const tiles = bounds.map((range, tileIndex) => {
    const segment = segments[tileIndex];
    return {
      shape: buildTriangle(center, radius, hubRadius + 2, range.start, range.end),
      color: settings.colors[segment % settings.colors.length] ?? "#8d382e",
      name: (tileIndex === WINNER_HIGHLIGHT && winnerNameOverride
        ? winnerNameOverride
        : participants[segment].name
      ).trim(),
    };
  });

  // 1. Cast shadows first so a tile never darkens its neighbour's face.
  for (const tile of tiles) {
    context.save();
    context.shadowColor = "rgba(0, 0, 0, 0.65)";
    context.shadowBlur = Math.max(10, size * 0.035);
    context.shadowOffsetX = Math.max(1, size * 0.004);
    context.shadowOffsetY = Math.max(4, size * 0.016);
    context.fillStyle = tile.color;
    traceTriangle(context, tile.shape);
    context.fill();
    context.restore();
  }

  // 2. Raised faces: slot colour, light-from-above shading, bevel and gold edge.
  const edge = Math.max(2.5, size * 0.0055);
  for (const { shape, color } of tiles) {
    context.save();
    traceTriangle(context, shape);
    context.fillStyle = color;
    context.fill();

    const shade = context.createLinearGradient(0, shape.top, 0, shape.bottom);
    shade.addColorStop(0, "rgba(255, 255, 255, 0.30)");
    shade.addColorStop(0.45, "rgba(255, 255, 255, 0.04)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.34)");
    context.fillStyle = shade;
    context.fill();

    context.save();
    context.clip();
    const bevel = context.createLinearGradient(0, shape.top, 0, shape.bottom);
    bevel.addColorStop(0, "rgba(255, 246, 200, 0.85)");
    bevel.addColorStop(0.5, "rgba(255, 246, 200, 0.12)");
    bevel.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    context.strokeStyle = bevel;
    context.lineWidth = edge * 2.6;
    context.lineJoin = "round";
    traceTriangle(context, shape);
    context.stroke();
    context.restore();

    context.lineJoin = "round";
    traceTriangle(context, shape);
    context.strokeStyle = "rgba(25, 12, 0, 0.7)";
    context.lineWidth = edge + 2;
    context.stroke();

    context.shadowColor = "#f3b93c";
    context.shadowBlur = Math.max(5, size * 0.014);
    context.strokeStyle = "#ffd83e";
    context.lineWidth = edge;
    context.stroke();

    context.shadowBlur = 0;
    context.strokeStyle = "#fff4a0";
    context.lineWidth = Math.max(0.8, size * 0.0018);
    context.stroke();
    context.restore();
  }

  // 3. Names: one shared font size (the largest at which every name fits), each name
  //    centred on its triangle's centroid and turned along the triangle's direction.
  const maxFont = Math.max(10, Math.min(20, size * 0.03));
  const minFont = Math.max(8, maxFont * 0.7);
  const fontFor = (fontSize: number) => `700 ${fontSize}px Inter, sans-serif`;
  let fontSize = minFont;
  let labels: string[][] | null = null;
  for (let candidate = maxFont; candidate >= minFont; candidate -= 0.5) {
    context.font = fontFor(candidate);
    const fitted = tiles.map((tile) => fitLabel(context, tile.name, tile.shape.labelRegion, candidate));
    if (fitted.every((lines): lines is string[] => lines !== null)) {
      fontSize = candidate;
      labels = fitted as string[][];
      break;
    }
  }
  context.font = fontFor(fontSize);
  if (!labels) {
    labels = tiles.map((tile) => truncateLabel(context, tile.name, tile.shape.labelRegion, fontSize));
  }

  const { lineHeight } = labelMetrics(fontSize, 1);
  tiles.forEach(({ shape }, tileIndex) => {
    const lines = labels[tileIndex];
    context.save();
    context.translate(shape.centroid.x, shape.centroid.y);
    context.rotate(shape.axis);
    context.font = fontFor(fontSize);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = settings.textColor;
    context.shadowColor = "#1a0b00";
    context.shadowBlur = 4;
    context.lineJoin = "round";
    context.strokeStyle = "#25170a";
    context.lineWidth = Math.max(2, fontSize * 0.18);
    lines.forEach((text, lineIndex) => {
      const y = (lineIndex - (lines.length - 1) / 2) * lineHeight;
      context.strokeText(text, 0, y);
      context.fillText(text, 0, y);
    });
    context.restore();
  });
}

function paint(
  canvas: HTMLCanvasElement,
  participants: Participant[],
  settings: WheelSettings,
  rotation: number,
  winnerNameOverride: string | null,
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
  const hubRadius = Math.max(34, size * 0.11);
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

    // Draw the regular segment labels when there is room for them. They are painted
    // before the highlighted triangles so the triangles (and their names) sit on top.
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
          label = `${label.slice(0, -2)}\u2026`;
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

  // Draw the three raised selection triangles above the rim and hub.
  if (participants.length > 0) {
    drawHighlights(
      context,
      participants,
      settings,
      rotation,
      size,
      center,
      radius,
      hubRadius,
      winnerNameOverride,
    );
  }

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

function sameRoster(a: readonly Participant[], b: readonly Participant[]): boolean {
  return a.length === b.length && a.every((person, index) => person.id === b[index].id && person.name === b[index].name);
}

export const Wheel = forwardRef<WheelHandle, WheelProps>(
  function Wheel(
    { participants, settings, stoppedWinner = null },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Single wheel state: the rotation plus the roster it is laid out with. The
    // animation, the triangle names and the winner all read from these two things.
    const rotationRef = useRef(0);
    const liveRef = useRef(participants);
    const settingsRef = useRef(settings);
    const stoppedRef = useRef(stoppedWinner);
    const frozenRef = useRef<{ roster: Participant[]; winnerId: string | null } | null>(null);
    const spinningRef = useRef(false);
    const hasSpunRef = useRef(false);

    // The roster to draw. During a spin, and after it stops, the wheel keeps the roster
    // it spun with, so removing the winner from the list cannot re-lay-out the wheel under
    // the final position. Any other change to the participants drops the snapshot.
    const displayRoster = (): Participant[] => {
      const frozen = frozenRef.current;
      if (!frozen) return liveRef.current;
      if (spinningRef.current) return frozen.roster;
      const live = liveRef.current;
      const withoutWinner = frozen.roster.filter((person) => person.id !== frozen.winnerId);
      if (sameRoster(live, frozen.roster) || sameRoster(live, withoutWinner)) return frozen.roster;
      frozenRef.current = null;
      return live;
    };

    const paintNow = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // A wheel that never spun here (e.g. the operator view) is not driven by a local
      // rotation, so it still shows the announced winner in the middle triangle.
      const override = hasSpunRef.current ? null : stoppedRef.current?.name ?? null;
      paint(canvas, displayRoster(), settingsRef.current, rotationRef.current, override);
    };

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      liveRef.current = participants;
      settingsRef.current = settings;
      stoppedRef.current = stoppedWinner;

      paintNow();

      const observer = new ResizeObserver(paintNow);
      observer.observe(canvas);

      return () => observer.disconnect();
    }, [participants, settings, stoppedWinner]);

    useImperativeHandle(
      ref,
      () => ({
        get rotation() {
          return rotationRef.current;
        },

        spinTo(target, duration, spinRoster) {
          return new Promise<number>((resolve, reject) => {
            const roster = [...(spinRoster ?? liveRef.current)];
            const canvas = canvasRef.current;

            if (roster.length === 0) {
              reject(new RangeError("The wheel has no participants to spin."));
              return;
            }

            if (!canvas) {
              resolve(winnerIndexAtRotation(target, roster.length));
              return;
            }

            hasSpunRef.current = true;
            frozenRef.current = { roster, winnerId: null };
            spinningRef.current = true;

            const start = rotationRef.current;
            const distance = target - start;
            const startedAt = performance.now();

            const frame = (now: number) => {
              try {
                const progress = Math.min(1, (now - startedAt) / duration);

                rotationRef.current =
                  progress >= 1
                    ? ((target % TAU) + TAU) % TAU
                    : start + distance * wheelSpinProgress(progress);

                paintNow();

                if (progress < 1) {
                  requestAnimationFrame(frame);
                  return;
                }

                // The wheel has fully stopped: the winner is whatever segment is under
                // the pointer at this exact final rotation.
                const landed = winnerIndexAtRotation(rotationRef.current, roster.length);
                frozenRef.current = { roster, winnerId: roster[landed].id };
                spinningRef.current = false;
                resolve(landed);
              } catch (error) {
                spinningRef.current = false;
                reject(error);
              }
            };

            requestAnimationFrame(frame);
          });
        },
      }),
      [],
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
