import { useEffect, useState } from "react";

function readVisibility() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

export function usePageVisibility() {
  const [isPageVisible, setIsPageVisible] = useState(readVisibility);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const onVisibilityChange = () => {
      setIsPageVisible(readVisibility());
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return isPageVisible;
}
