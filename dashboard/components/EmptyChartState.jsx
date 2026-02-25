export default function EmptyChartState({ filterLabel, style }) {
  const boundedStyle = {
    ...style,
    minHeight: 0,
    maxHeight: "100%",
    height: style?.height || "100%",
    overflow: "hidden",
  };
  return (
    <div style={boundedStyle}>
      <span>{`Verborgen omdat filter \`${filterLabel}\` actief is.`}</span>
    </div>
  );
}
