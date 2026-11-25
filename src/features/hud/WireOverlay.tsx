import type { ProviderKind } from "@/domain/types";
import type { BusAnchor, WireEdge } from "./topology-types";

/**
 * Dynamic SVG Bezier wire layer plus the right-edge failover trunk bus.
 * Pure presentational: all geometry is measured by TopologyCanvas.
 */
export function WireOverlay({
  wires,
  busAnchors,
  stageBounds,
  onlineCount,
  totalAccounts,
}: {
  wires: WireEdge[];
  busAnchors: BusAnchor[];
  stageBounds: { width: number; height: number };
  onlineCount: number;
  totalAccounts: number;
}) {
  return (
    <svg
      width={stageBounds.width}
      height={stageBounds.height}
      className="pointer-events-none absolute inset-0 hidden lg:block"
      aria-hidden="true"
    >
      {wires
        .filter((w) => !w.selected)
        .map((wire) => {
          const dx = Math.max(54, Math.abs(wire.x2 - wire.x1) * 0.48);
          const d = `M ${wire.x1} ${wire.y1} C ${wire.x1 + dx} ${wire.y1}, ${wire.x2 - dx} ${wire.y2}, ${wire.x2} ${wire.y2}`;
          return (
            <g key={wire.id}>
              <path
                d={d}
                fill="none"
                stroke={wire.failed ? "#6b3132" : "#2f3644"}
                strokeWidth={1.2}
                strokeOpacity={0.85}
              />
            </g>
          );
        })}

      {wires.slice(0, 5).map((wire, idx) => {
        const mx = (wire.x1 + wire.x2) / 2;
        const my = (wire.y1 + wire.y2) / 2 + (idx % 2 === 0 ? -4 : 6);
        if (wire.selected) return null;
        return (
          <g key={`pill-${wire.id}`} transform={`translate(${mx}, ${my})`}>
            <rect
              x={-18}
              y={-8}
              width={36}
              height={16}
              rx={8}
              fill="#141820"
              stroke="#323948"
              strokeWidth={1}
            />
            <text
              x={0}
              y={3}
              textAnchor="middle"
              fill="#96a0b3"
              fontSize={8}
              fontFamily="var(--font-geist-mono), monospace"
            >
              {wire.badge}
            </text>
          </g>
        );
      })}

      {wires
        .filter((w) => w.selected)
        .map((wire) => {
          const dx = Math.max(56, Math.abs(wire.x2 - wire.x1) * 0.48);
          const d = `M ${wire.x1} ${wire.y1} C ${wire.x1 + dx} ${wire.y1}, ${wire.x2 - dx} ${wire.y2}, ${wire.x2} ${wire.y2}`;
          const mx = (wire.x1 + wire.x2) / 2;
          const my = (wire.y1 + wire.y2) / 2;
          return (
            <g key={`sel-${wire.id}`}>
              <path
                d={d}
                fill="none"
                stroke="#c48a47"
                strokeWidth={1.8}
                strokeDasharray="5 4"
                className="wire-selected-animated"
              />
              <circle cx={wire.x1} cy={wire.y1} r={3} fill="#c48a47" />
              <circle cx={wire.x2} cy={wire.y2} r={3.2} fill="#56b868" />
              <g transform={`translate(${mx}, ${my})`}>
                <rect
                  x={-21}
                  y={-9}
                  width={42}
                  height={18}
                  rx={9}
                  fill="#22190f"
                  stroke="#c48a47"
                  strokeWidth={1}
                />
                <text
                  x={0}
                  y={3}
                  textAnchor="middle"
                  fill="#e5b06e"
                  fontSize={8.5}
                  fontWeight={600}
                  fontFamily="var(--font-geist-mono), monospace"
                >
                  {wire.badge}
                </text>
              </g>
            </g>
          );
        })}

      {/* Scalable N-account right-edge Failover Trunk Spine + dynamic provider sub-rails */}
      {busAnchors.length >= 2
        ? (() => {
            const baseX = Math.max(...busAnchors.map((b) => b.x));
            const subRailX = baseX + 14;
            const trunkX = baseX + 34;
            const failoverNodes = busAnchors.filter((b) => b.autoFailover);
            const trunkNodes =
              failoverNodes.length >= 2 ? failoverNodes : busAnchors;
            const minY = Math.min(...trunkNodes.map((b) => b.y));
            const maxY = Math.max(...trunkNodes.map((b) => b.y));
            const midY = (minY + maxY) / 2;
            const poolActive =
              trunkNodes.filter((b) => b.online).length >= 2;

            // Group by provider for same-provider inner failover sub-rails
            const byProvider = new Map<ProviderKind, BusAnchor[]>();
            for (const anchor of busAnchors) {
              const list = byProvider.get(anchor.provider) ?? [];
              list.push(anchor);
              byProvider.set(anchor.provider, list);
            }
            const providerRails = Array.from(byProvider.entries()).filter(
              ([, list]) => list.length >= 2,
            );

            const nodeDot = (active: boolean) =>
              active ? "#56b868" : "#444d5e";

            return (
              <g>
                {/* Inner provider sub-rails for multi-account same-provider groups */}
                {providerRails.map(([prov, group]) => {
                  const gMinY = Math.min(...group.map((a) => a.y)) - 5;
                  const gMaxY = Math.max(...group.map((a) => a.y)) - 5;
                  const gActive =
                    group.filter((a) => a.online).length >= 2;
                  const stroke = gActive ? "#4e9c5d" : "#2d3442";
                  return (
                    <g key={`subrail-${prov}`}>
                      <line
                        x1={subRailX}
                        y1={gMinY}
                        x2={subRailX}
                        y2={gMaxY}
                        stroke={stroke}
                        strokeWidth={1.3}
                      />
                      {group.map((a) => (
                        <g key={`subtap-${a.accountId}`}>
                          <line
                            x1={a.x}
                            y1={a.y - 5}
                            x2={subRailX}
                            y2={a.y - 5}
                            stroke={stroke}
                            strokeWidth={1.3}
                          />
                          <circle
                            cx={a.x}
                            cy={a.y - 5}
                            r={2.4}
                            fill={nodeDot(a.online)}
                          />
                        </g>
                      ))}
                    </g>
                  );
                })}

                {/* Outer shared Failover Trunk Spine for all N accounts */}
                <line
                  x1={trunkX}
                  y1={minY + 5}
                  x2={trunkX}
                  y2={maxY + 5}
                  stroke={poolActive ? "#4e9c5d" : "#282e3b"}
                  strokeWidth={1.4}
                />
                {trunkNodes.map((a) => (
                  <g key={`trunk-${a.accountId}`}>
                    <line
                      x1={a.x}
                      y1={a.y + 5}
                      x2={trunkX}
                      y2={a.y + 5}
                      stroke={
                        a.online && poolActive ? "#4e9c5d" : "#2b3240"
                      }
                      strokeWidth={1.25}
                    />
                    <circle
                      cx={a.x}
                      cy={a.y + 5}
                      r={2.4}
                      fill={nodeDot(a.online)}
                    />
                  </g>
                ))}

                <g transform={`translate(${trunkX}, ${midY}) rotate(90)`}>
                  <rect
                    x={-58}
                    y={-7.5}
                    width={116}
                    height={15}
                    rx={3}
                    fill={poolActive ? "#101a13" : "#14171d"}
                    stroke={poolActive ? "#35663e" : "#2a3140"}
                    strokeWidth={0.9}
                  />
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fill={poolActive ? "#7fd18e" : "#848ea0"}
                    fontSize={7.5}
                    fontFamily="var(--font-geist-mono), monospace"
                  >
                    {`FAILOVER BUS · ${onlineCount}/${totalAccounts}`}
                  </text>
                </g>
              </g>
            );
          })()
        : null}
    </svg>
  );
}
