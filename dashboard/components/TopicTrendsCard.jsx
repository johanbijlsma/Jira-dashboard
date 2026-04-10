// @ts-check

import { useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import EmptyChartState from "./EmptyChartState";
import { buildMovingAverage } from "../lib/topic-trends";
import { num } from "../lib/dashboard-utils";

/**
 * @typedef {{
 *   topic: string;
 *   buckets: Array<{ label: string; count: number }>;
 *   total: number;
 *   color: string;
 *   trend: { symbol: string; text: string; color: string };
 *   recentTotal: number;
 *   previousTotal: number;
 * }} TopicTrendSeries
 */

function TopicSparkline({ topic, selected, expanded, onSelect }) {
  const { buckets, color, total, trend } = topic;
  const data = useMemo(
    () => ({
      labels: buckets.map((bucket) => bucket.label),
      datasets: [
        {
          data: buckets.map((bucket) => bucket.count),
          borderColor: color,
          backgroundColor: color,
          borderWidth: selected ? 2 : 1.5,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.35,
          fill: false,
        },
      ],
    }),
    [buckets, color, selected]
  );

  const [hovered, setHovered] = useState(false);
  const rowStyle = {
    width: "100%",
    border: selected ? "1px solid color-mix(in srgb, var(--accent) 60%, var(--border))" : "1px solid transparent",
    borderRadius: 12,
    background: selected
      ? "color-mix(in srgb, var(--accent) 10%, var(--surface))"
      : hovered
        ? "color-mix(in srgb, var(--text-main) 4%, var(--surface))"
        : "transparent",
    padding: expanded ? "10px 12px" : "8px 10px",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.6fr) minmax(120px, 1fr) auto auto",
    gap: 10,
    alignItems: "center",
    cursor: "pointer",
    appearance: "none",
    transition: "background 120ms ease, border-color 120ms ease, transform 120ms ease",
    transform: hovered ? "translateY(-1px)" : "translateY(0)",
    textAlign: "left",
    color: "inherit",
  };

  return (
    <button
      type="button"
      onClick={() => onSelect(topic.topic)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={rowStyle}
      aria-pressed={selected}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {topic.topic}
        </span>
      </span>
      <span style={{ height: 34, minWidth: 120 }}>
        <Line
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            events: [],
            plugins: {
              legend: { display: false },
              tooltip: { enabled: false },
            },
            scales: {
              x: { display: false },
              y: { display: false },
            },
          }}
        />
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{num(total)}</span>
      <span
        style={{
          color: trend.color,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          justifySelf: "end",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
        title={`Laatste 2 periodes: ${num(topic.recentTotal)}. Vorige 2 periodes: ${num(topic.previousTotal)}.`}
      >
        <strong>{trend.symbol}</strong>
        <span>{trend.text}</span>
      </span>
    </button>
  );
}

function TopicDetailChart({
  topic,
  labels,
  buildChartAxis,
  chartKey,
  animation,
  releaseCadencePlugin,
  markChartReady,
  onPointClick,
}) {
  const [showMovingAverage, setShowMovingAverage] = useState(false);
  const values = topic.buckets.map((bucket) => bucket.count);
  const movingAverage = useMemo(() => buildMovingAverage(values, 3), [values]);
  const data = useMemo(() => ({
    labels,
    datasets: [
      {
        label: topic.topic,
        data: values,
        tension: 0.25,
        borderColor: topic.color,
        backgroundColor: topic.color,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        fill: false,
      },
      ...(showMovingAverage
        ? [
            {
              label: `3-periode gemiddelde`,
              data: movingAverage,
              tension: 0.3,
              borderColor: "#64748b",
              backgroundColor: "#64748b",
              borderDash: [5, 4],
              pointRadius: 0,
              pointHoverRadius: 0,
              pointHitRadius: 0,
              fill: false,
            },
          ]
        : []),
    ],
  }), [labels, movingAverage, showMovingAverage, topic.color, topic.topic, values]);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "color-mix(in srgb, var(--surface) 94%, var(--surface-muted))",
        padding: 14,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        flex: 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Geselecteerd onderwerp</div>
          <div style={{ fontSize: 18, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {topic.topic}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            {num(topic.total)} tickets in de gekozen periode
          </div>
        </div>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          <input
            type="checkbox"
            checked={showMovingAverage}
            onChange={(event) => setShowMovingAverage(event.target.checked)}
          />
          Voortschrijdend gemiddelde
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 220 }}>
        <Line
          key={chartKey}
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            animation,
            onClick: (_event, elements) => {
              const element = elements?.[0];
              if (!element) return;
              const bucket = topic.buckets[element.index];
              if (!bucket) return;
              onPointClick(bucket.label, topic.topic);
            },
            plugins: {
              legend: { display: false },
              tooltip: { mode: "index", intersect: false },
              releaseCadence: releaseCadencePlugin,
              renderWatch: { onReady: markChartReady },
            },
            interaction: { mode: "index", intersect: false },
            scales: {
              x: buildChartAxis({}),
              y: buildChartAxis({
                title: "Aantal tickets",
                tickCallback: (value) => num(value),
                beginAtZero: true,
              }),
            },
          }}
        />
      </div>
    </div>
  );
}

/**
 * @param {{
 *   topics: TopicTrendSeries[];
 *   selectedTopic: string;
 *   onSelectTopic: (topic: string) => void;
 *   onDetailPointClick: (bucketLabel: string, topic: string) => void;
 *   labels: string[];
 *   buildChartAxis: (input: { title?: string; tickCallback?: (value: number | string) => string; tickOptions?: object; gridDisplay?: boolean; beginAtZero?: boolean }) => object;
 *   chartKey: string;
 *   animation: false | object | undefined;
 *   releaseCadencePlugin: object;
 *   markChartReady: () => void;
 *   renderOverlay: () => unknown;
 *   expanded?: boolean;
 * }} props
 */
export default function TopicTrendsCard({
  topics,
  selectedTopic,
  onSelectTopic,
  onDetailPointClick,
  labels,
  buildChartAxis,
  chartKey,
  animation,
  releaseCadencePlugin,
  markChartReady,
  renderOverlay,
  expanded = false,
}) {
  const selected = topics.find((topic) => topic.topic === selectedTopic) || topics[0] || null;

  if (!topics.length || !selected) {
    return <EmptyChartState filterLabel="Onderwerp" style={{ height: "100%" }} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "stretch",
          minHeight: 0,
          flex: 1,
        }}
      >
        <div
          style={{
            flex: "0 1 360px",
            minWidth: 280,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ padding: "4px 4px 8px" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Top-5 onderwerpen</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Gesorteerd op totaal aantal tickets binnen de huidige periode.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, overflow: "auto", paddingRight: 2 }}>
            {topics.map((topic) => (
              <TopicSparkline
                key={topic.topic}
                topic={topic}
                selected={topic.topic === selected.topic}
                expanded={expanded}
                onSelect={onSelectTopic}
              />
            ))}
          </div>
        </div>
        <div style={{ flex: "1 1 460px", minWidth: 0, display: "flex", position: "relative" }}>
          <TopicDetailChart
            topic={selected}
            labels={labels}
            buildChartAxis={buildChartAxis}
            chartKey={chartKey}
            animation={animation}
            releaseCadencePlugin={releaseCadencePlugin}
            markChartReady={markChartReady}
            onPointClick={onDetailPointClick}
          />
          {renderOverlay()}
        </div>
      </div>
    </div>
  );
}
