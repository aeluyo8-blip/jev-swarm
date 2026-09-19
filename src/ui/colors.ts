/** Shared snake palette (index-based, matches Board rendering). */
export const snakeColor = (index: number): string =>
  `hsl(${(index * 137.508 + 190) % 360} 72% 58%)`;

export const shortId = (agentId: string): string =>
  `S${Number(agentId.slice("snake_".length))}`;
