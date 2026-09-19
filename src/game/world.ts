import type {
  ActionFeaturesByAction,
  AgentInfo,
  DeathEvent,
  Direction,
  EatEvent,
  RelativeAction,
  Vec,
} from "./types";
import { cellKey } from "./types";
import { mulberry32, rngInt, type Rng } from "./rng";
import { targetCell, turnDirection } from "./geometry";
import { buildOccupancy, resolveDeaths, type Mover } from "./collision";
import { computeActionFeatures } from "./features";

/**
 * World-agnostic contract (plan §3.1). Snake is only the first world;
 * vehicles, warehouse robots or NPCs can implement the same interface and
 * reuse the resolver + model client stack unchanged.
 */
export interface CandidateAction {
  id: string; // "LEFT" | "STRAIGHT" | "RIGHT" for the snake world
}

export interface JointAction {
  [agentId: string]: string | undefined;
}

export interface ValidationResult {
  valid: boolean;
  violations: Array<{ agentId: string; reason: string }>;
}

export interface MultiAgentWorld {
  getSharedState(): unknown;
  getAgents(): AgentInfo[];
  getCandidates(agent: AgentInfo): CandidateAction[];
  analyzeCandidate(agent: AgentInfo, action: CandidateAction): unknown;
  validateJointActions(actions: JointAction): ValidationResult;
  step(actions: JointAction): void;
}
export interface SnakeWorldConfig {
  width: number;
  height: number;
  snakeCount: number;
  initialLength: number;
  /** Food items kept on the board (plan: 5–10). */
  foodTarget: number;
  seed: number;
}

export interface SnakeState {
  id: string;
  index: number;
  alive: boolean;
  direction: Direction;
  /** Head first. */
  cells: Vec[];
  /** Cells from the previous tick, for render interpolation. */
  prevCells: Vec[];
  /** Tick at which the snake died (render fade-out). */
  diedAtTick: number | null;
}

export interface WorldEvents {
  deaths: DeathEvent[];
  eats: EatEvent[];
  rawConflicts: { sharedTarget: number; headSwap: number };
}

export const SNAKE_TEAM_GOAL =
  "Keep all snakes alive while collecting as much food as possible.";

const DEFAULT_CONFIG: SnakeWorldConfig = {
  width: 30,
  height: 30,
  snakeCount: 10,
  initialLength: 3,
  foodTarget: 8,
  seed: 42,
};

export class SnakeWorld implements MultiAgentWorld {
  readonly config: SnakeWorldConfig;
  snakes: SnakeState[] = [];
  food: Vec[] = [];
  obstacles: Vec[] = [];
  tick = 0;
  status: "running" | "game_over" = "running";
  generation = 1;
  /** Events produced by the last step() call. */
  lastEvents: WorldEvents = emptyEvents();
  private rng: Rng;

  constructor(config: Partial<SnakeWorldConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rng = mulberry32(this.config.seed);
    this.spawnWorld();
  }

  // ---------------------------------------------------------------- spawning

  private spawnWorld(): void {
    this.snakes = [];
    this.food = [];
    this.obstacles = [];
    this.tick = 0;
    this.status = "running";
    this.rng = mulberry32(this.config.seed + (this.generation - 1) * 7919);

    const ring = this.perimeterRing();
    const n = this.config.snakeCount;
    for (let i = 0; i < n; i++) {
      const head = ring[Math.floor((i * ring.length) / n)];
      const direction = this.inwardDirection(head);
      const cells: Vec[] = [];
      for (let j = 0; j < this.config.initialLength; j++) {
        cells.push({
          x: head.x - stepX(direction) * j,
          y: head.y - stepY(direction) * j,
        });
      }
      this.snakes.push({
        id: snakeId(i),
        index: i,
        alive: true,
        direction,
        cells,
        prevCells: cells.map((c) => ({ ...c })),
        diedAtTick: null,
      });
    }

    for (let i = 0; i < this.config.foodTarget; i++) this.spawnFood();
  }

  /** Ring of cells two steps inside the border, used for spawn slots. */
  private perimeterRing(): Vec[] {
    const { width: w, height: h } = this.config;
    const m = 2;
    const ring: Vec[] = [];
    for (let x = m; x < w - m; x++) ring.push({ x, y: m });
    for (let y = m + 1; y < h - m; y++) ring.push({ x: w - 1 - m, y });
    for (let x = w - 2 - m; x >= m; x--) ring.push({ x, y: h - 1 - m });
    for (let y = h - 2 - m; y > m; y--) ring.push({ x: m, y });
    return ring;
  }

  private inwardDirection(cell: Vec): Direction {
    const { width: w, height: h } = this.config;
    if (cell.y <= 2) return "south";
    if (cell.y >= h - 3) return "north";
    if (cell.x <= 2) return "east";
    if (cell.x >= w - 3) return "west";
    return "east";
  }

  private occupiedCellSet(): Set<string> {
    const occupied = new Set<string>();
    for (const s of this.snakes) {
      if (!s.alive) continue;
      for (const c of s.cells) occupied.add(cellKey(c));
    }
    return occupied;
  }

  private spawnFood(): void {
    const occupied = this.occupiedCellSet();
    for (const f of this.food) occupied.add(cellKey(f));
    for (const o of this.obstacles) occupied.add(cellKey(o));
    const { width: w, height: h } = this.config;
    for (let attempt = 0; attempt < 500; attempt++) {
      const cell = { x: rngInt(this.rng, w), y: rngInt(this.rng, h) };
      if (!occupied.has(cellKey(cell))) {
        this.food.push(cell);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- queries

  getAgents(): AgentInfo[] {
    return this.snakes
      .filter((s) => s.alive)
      .map((s) => ({
        id: s.id,
        index: s.index,
        alive: s.alive,
        length: s.cells.length,
        direction: s.direction,
        head: s.cells[0],
      }));
  }

  getCandidates(_agent: AgentInfo): CandidateAction[] {
    return (
      ["LEFT", "STRAIGHT", "RIGHT"] as RelativeAction[]
    ).map((id) => ({ id }));
  }

  /** Shared, world-only part of the state (agents are added by the analyzer). */
  getSharedState(): unknown {
    return {
      board: { width: this.config.width, height: this.config.height },
      food: this.food.map((f) => [f.x, f.y]),
      obstacles: this.obstacles.map((o) => [o.x, o.y]),
      team_goal: SNAKE_TEAM_GOAL,
      tick: this.tick,
    };
  }

  /** Deterministic facts for one candidate action (contract method). */
  analyzeCandidate(agent: AgentInfo, action: CandidateAction): unknown {
    const snake = this.snakeById(agent.id);
    if (!snake || !snake.alive) return null;
    return computeActionFeatures(this, snake)[normalizeAction(action.id)];
  }

  /** Hard-constraint validation of a joint action (contract method). */
  validateJointActions(actions: JointAction): ValidationResult {
    const alive = this.aliveSnakes();
    const occupied = buildOccupancy(
      alive.map((s) => ({ cells: s.cells, grows: false, moves: false })),
      this.obstacles,
    );
    const movers: Mover[] = alive.map((snake) => {
      const action = normalizeAction(actions[snake.id]);
      return {
        id: snake.id,
        head: snake.cells[0],
        direction: turnDirection(snake.direction, action),
        action,
        target: targetCell(snake.cells[0], snake.direction, action),
      };
    });
    const verdict = resolveDeaths(
      movers,
      this.config.width,
      this.config.height,
      occupied,
      this.obstacleSet(),
    );
    const violations = [...verdict.deaths].map(([agentId, death]) => ({
      agentId,
      reason: death.detail ? `${death.cause} (${death.detail})` : death.cause,
    }));
    return { valid: violations.length === 0, violations };
  }

  aliveSnakes(): SnakeState[] {
    return this.snakes.filter((s) => s.alive);
  }

  snakeById(id: string): SnakeState | undefined {
    return this.snakes.find((s) => s.id === id);
  }

  foodSet(): Set<string> {
    return new Set(this.food.map(cellKey));
  }

  obstacleSet(): Set<string> {
    return new Set(this.obstacles.map(cellKey));
  }

  // ---------------------------------------------------------------- stepping

  step(actions: JointAction): void {
    if (this.status !== "running") return;
    const alive = this.aliveSnakes();
    const foodSet = this.foodSet();
    const obstacles = this.obstacleSet();

    const movers: Mover[] = alive.map((snake) => {
      const action = normalizeAction(actions[snake.id]);
      const direction = turnDirection(snake.direction, action);
      return {
        id: snake.id,
        head: snake.cells[0],
        direction,
        action,
        target: targetCell(snake.cells[0], snake.direction, action),
      };
    });

    // Growth is known before deaths: a snake whose target is food grows,
    // which decides whether its tail vacates for occupancy purposes.
    const grows = new Map<string, boolean>();
    for (const m of movers) grows.set(m.id, foodSet.has(cellKey(m.target)));

    // Deaths are resolved against occupancy, and occupancy depends on who
    // survives (a dying snake never advances, so its tail cannot vacate).
    // Iterate to the fixpoint: assume every mover advances, then strip the
    // snakes that died until the moving set stops shrinking (monotone, so
    // size equality means the set is stable).
    let movedIds = new Set(movers.map((m) => m.id));
    let verdict = resolveDeaths(
      movers,
      this.config.width,
      this.config.height,
      buildOccupancy(
        alive.map((s) => ({ cells: s.cells, grows: grows.get(s.id) ?? false, moves: movedIds.has(s.id) })),
        this.obstacles,
      ),
      obstacles,
    );
    for (;;) {
      const nextMoved = movers.filter((m) => !verdict.deaths.has(m.id)).map((m) => m.id);
      if (nextMoved.length === movedIds.size) break;
      movedIds = new Set(nextMoved);
      verdict = resolveDeaths(
        movers,
        this.config.width,
        this.config.height,
        buildOccupancy(
          alive.map((s) => ({ cells: s.cells, grows: grows.get(s.id) ?? false, moves: movedIds.has(s.id) })),
          this.obstacles,
        ),
        obstacles,
      );
    }

    // Apply movement for survivors.
    const deaths = verdict.deaths;
    const eatenCells = new Set<string>();
    const events = emptyEvents();
    this.lastEvents = events;

    const survivors = movers.filter((m) => !deaths.has(m.id));
    for (const m of survivors) {
      const snake = this.snakeById(m.id);
      if (!snake) continue;
      const key = cellKey(m.target);
      const willGrow = foodSet.has(key);
      snake.prevCells = snake.cells.map((c) => ({ ...c }));
      const nextCells = [{ ...m.target }, ...snake.cells];
      if (!willGrow) nextCells.pop();
      snake.cells = nextCells;
      snake.direction = m.direction;
      if (willGrow) {
        eatenCells.add(key);
        events.eats.push({ agentId: m.id, tick: this.tick, cell: { ...m.target } });
      }
    }

    if (eatenCells.size > 0) {
      this.food = this.food.filter((f) => !eatenCells.has(cellKey(f)));
      // Cap the refill attempts: when the board is nearly full a food
      // shortfall is acceptable, an infinite loop is not (P0 fix).
      for (
        let i = 0;
        i < this.config.foodTarget && this.food.length < this.config.foodTarget;
        i++
      ) {
        this.spawnFood();
      }
    }

    for (const [id, death] of deaths) {
      const snake = this.snakeById(id);
      if (!snake) continue;
      snake.alive = false;
      snake.diedAtTick = this.tick;
      events.deaths.push({ agentId: id, tick: this.tick, cause: death.cause, detail: death.detail });
    }

    events.rawConflicts = {
      sharedTarget: verdict.sharedTargetGroups.reduce((acc, g) => acc + g.length, 0),
      headSwap: verdict.headSwapPairs.length * 2,
    };

    this.tick += 1;
    if (this.aliveSnakes().length === 0) this.status = "game_over";
  }

  // ---------------------------------------------------------------- chaos

  /** One-shot disruption: relocate all food and drop a fresh obstacle cluster. */
  chaos(): void {
    this.food = [];
    this.obstacles = []; // replace, never accumulate (repeated chaos must not fill the board)
    for (let i = 0; i < this.config.foodTarget; i++) this.spawnFood();
    const occupied = this.occupiedCellSet();
    for (const f of this.food) occupied.add(cellKey(f));
    const clusterSize = 8 + rngInt(this.rng, 7);
    let cursor = {
      x: 4 + rngInt(this.rng, this.config.width - 8),
      y: 4 + rngInt(this.rng, this.config.height - 8),
    };
    for (let i = 0; i < clusterSize; i++) {
      if (!occupied.has(cellKey(cursor))) {
        this.obstacles.push({ ...cursor });
        occupied.add(cellKey(cursor));
      }
      const dir = ["north", "east", "south", "west"][rngInt(this.rng, 4)];
      cursor = {
        x: Math.min(this.config.width - 1, Math.max(0, cursor.x + (dir === "east" ? 1 : dir === "west" ? -1 : 0))),
        y: Math.min(this.config.height - 1, Math.max(0, cursor.y + (dir === "south" ? 1 : dir === "north" ? -1 : 0))),
      };
    }
  }

  reset(): void {
    this.generation += 1;
    this.spawnWorld();
    this.lastEvents = emptyEvents();
  }
}

export function snakeId(index: number): string {
  return `snake_${String(index + 1).padStart(2, "0")}`;
}

export function normalizeAction(action: string | undefined): RelativeAction {
  return action === "LEFT" || action === "RIGHT" ? action : "STRAIGHT";
}

function stepX(d: Direction): number {
  return d === "east" ? 1 : d === "west" ? -1 : 0;
}

function stepY(d: Direction): number {
  return d === "south" ? 1 : d === "north" ? -1 : 0;
}

function emptyEvents(): WorldEvents {
  return { deaths: [], eats: [], rawConflicts: { sharedTarget: 0, headSwap: 0 } };
}

/** Features per action, attached to the world snapshot for the current tick. */
export type FeaturesById = Map<string, ActionFeaturesByAction>;
