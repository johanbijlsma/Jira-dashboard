import { useState } from "react";
import { initialsFromName } from "../lib/dashboard-utils";

export default function VacationAvatar({ name, avatarUrl, style }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!avatarUrl && !imgFailed;
  return (
    <span
      style={{
        width: 34,
        height: 34,
        borderRadius: "999px",
        border: "2px solid #fff",
        boxShadow: "0 0 0 1px var(--border), 0 2px 6px var(--shadow-medium)",
        overflow: "hidden",
        background: "var(--surface-muted)",
        color: "var(--text-main)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
        flex: "0 0 auto",
        ...style,
      }}
      title={name || "Onbekend"}
      aria-label={name || "Onbekend"}
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt={name || "Assignee avatar"}
          onError={() => setImgFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span>{initialsFromName(name)}</span>
      )}
    </span>
  );
}
