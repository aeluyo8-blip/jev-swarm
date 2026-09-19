import { useEffect, useRef } from "react";
import type { ArenaSimulation } from "../sim/simulation";
import { useArenaStore } from "./store";
import { useT, format } from "./i18n";
import type { SnakeState } from "../game/world";
import type { Vec } from "../game/types";

const CELL = 22;
const PADDING = 6;
/** Corpses fade out over this many ticks, then stop rendering entirely. */
const CORPSE_FADE_TICKS = 3;

const snakeColor = (index: number): string =>
  `hsl(${(index * 137.508 + 190) % 360} 72% 58%)`;
const snakeHeadColor = (index: number): string =>
  `hsl(${(index * 137.508 + 190) % 360} 85% 72%)`;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function segmentPosition(prev: Vec[], cur: Vec[], i: number, t: number): Vec {
  const target = cur[i];
  if (t >= 1 || prev.length === 0) return target;
  const from = prev[Math.min(i, prev.length - 1)];
  return { x: lerp(from.x, target.x, t), y: lerp(from.y, target.y, t) };
}

function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: SnakeState,
  t: number,
  selected: boolean,
  ageTicks: number,
) {
  if (!snake.alive && ageTicks > CORPSE_FADE_TICKS) return; // gone: corpses don't block
  const alpha = snake.alive ? 1 : 0.16 * (1 - ageTicks / CORPSE_FADE_TICKS);
  ctx.globalAlpha = alpha;
  const color = snakeColor(snake.index);

  // Body from tail to head so the head paints on top.
  for (let i = snake.cells.length - 1; i >= 0; i--) {
    const pos = snake.alive
      ? segmentPosition(snake.prevCells, snake.cells, i, t)
      : snake.cells[i];
    const x = PADDING + pos.x * CELL;
    const y = PADDING + pos.y * CELL;
    const inset = i === 0 ? 1.5 : 2.5;
    ctx.fillStyle = i === 0 ? snakeHeadColor(snake.index) : color;
    roundRect(ctx, x + inset, y + inset, CELL - inset * 2, CELL - inset * 2, i === 0 ? 7 : 5);
    ctx.fill();
    if (selected && i === 0) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      roundRect(ctx, x + 0.5, y + 0.5, CELL - 1, CELL - 1, 8);
      ctx.stroke();
    }
  }

  // Eyes show current heading.
  if (snake.alive) {
    const head = segmentPosition(snake.prevCells, snake.cells, 0, t);
    const cx = PADDING + head.x * CELL + CELL / 2;
    const cy = PADDING + head.y * CELL + CELL / 2;
    const dir = snake.direction;
    const fx = dir === "east" ? 1 : dir === "west" ? -1 : 0;
    const fy = dir === "south" ? 1 : dir === "north" ? -1 : 0;
    const px = fy !== 0 ? 4 : 0;
    const py = fx !== 0 ? 4 : 0;
    ctx.fillStyle = "#0f172a";
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.arc(cx + fx * 4.5 + px * s, cy + fy * 4.5 + py * s, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function Board({ simRef }: { simRef: React.RefObject<ArenaSimulation | null> }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stepAtRef = useRef(0);
  const selectedRef = useRef<string | null>(null);

  const lastResult = useArenaStore((s) => s.lastResult);
  const selectedAgentId = useArenaStore((s) => s.selectedAgentId);
  const config = useArenaStore((s) => s.config);
  const started = useArenaStore((s) => s.started);
  selectedRef.current = selectedAgentId;

  useEffect(() => {
    stepAtRef.current = performance.now();
  }, [lastResult]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const sim = simRef.current;
      if (!sim) return;
      const world = sim.world;
      const { width, height } = world.config;
      const size = width * CELL + PADDING * 2;
      if (canvas.width !== size || canvas.height !== height * CELL + PADDING * 2) {
        canvas.width = size;
        canvas.height = height * CELL + PADDING * 2;
      }

      // Background
      ctx.fillStyle = "#0b1120";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(148,163,184,0.08)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= width; i++) {
        ctx.beginPath();
        ctx.moveTo(PADDING + i * CELL, PADDING);
        ctx.lineTo(PADDING + i * CELL, PADDING + height * CELL);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(PADDING, PADDING + i * CELL);
        ctx.lineTo(PADDING + width * CELL, PADDING + i * CELL);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(148,163,184,0.25)";
      ctx.strokeRect(PADDING, PADDING, width * CELL, height * CELL);

      // Obstacles
      ctx.fillStyle = "#334155";
      for (const o of world.obstacles) {
        roundRect(ctx, PADDING + o.x * CELL + 2, PADDING + o.y * CELL + 2, CELL - 4, CELL - 4, 4);
        ctx.fill();
      }

      // Food (gentle pulse)
      const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 280);
      for (const f of world.food) {
        const cx = PADDING + f.x * CELL + CELL / 2;
        const cy = PADDING + f.y * CELL + CELL / 2;
        ctx.fillStyle = "#fbbf24";
        ctx.shadowColor = "#f59e0b";
        ctx.shadowBlur = 8 * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, 5.5 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Snakes
      const tickMs = Math.max(50, sim.config.tickMs);
      const t = Math.min(1, (performance.now() - stepAtRef.current) / tickMs);
      for (const snake of world.snakes) {
        const ageTicks = snake.alive ? 0 : world.tick - (snake.diedAtTick ?? world.tick);
        drawSnake(ctx, snake, t, snake.id === selectedRef.current, ageTicks);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [simRef]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = e.currentTarget.width / rect.width;
    const x = Math.floor((e.nativeEvent.offsetX * scale - PADDING) / CELL);
    const y = Math.floor((e.nativeEvent.offsetY * scale - PADDING) / CELL);
    let hit: string | null = null;
    let bestDist = Infinity;
    for (const snake of sim.world.aliveSnakes()) {
      for (const [i, cell] of snake.cells.entries()) {
        const d = Math.abs(cell.x - x) + Math.abs(cell.y - y);
        const weight = i === 0 ? 0 : 1; // prefer heads
        if (d <= 2 + weight && d + weight < bestDist) {
          bestDist = d + weight;
          hit = snake.id;
        }
      }
    }
    useArenaStore.getState().select(hit);
  };

  const gameOver = lastResult?.gameOver ?? false;
  const benchmarkRunning = useArenaStore((s) => s.benchmarkRunning);

  return (
    <div className="board-wrap">
      <canvas
        ref={canvasRef}
        className="board-canvas"
        onClick={handleClick}
        style={{ width: 30 * CELL + PADDING * 2, maxWidth: "100%" }}
      />
      {gameOver && (
        <div className="board-overlay">
          <div className="board-overlay-card">
            <div>{t("overlayDead")}</div>
            <div className="board-overlay-sub">
              {format(t("overlaySub"), { tick: lastResult?.tick ?? 0 })}
            </div>
          </div>
        </div>
      )}
      {!started && (
        <div className="board-overlay">
          <div className="board-overlay-card board-overlay-start">
            <div>{t("startOverlay")}</div>
          </div>
        </div>
      )}
      {benchmarkRunning && (
        <div className="board-overlay">
          <div className="board-overlay-card board-overlay-start">
            <div>{t("benchOverlay")}</div>
          </div>
        </div>
      )}
      <div className="board-hint">{format(t("boardHint"), { agents: config.agents })}</div>
    </div>
  );
}
