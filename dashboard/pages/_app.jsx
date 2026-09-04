import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-900.css";
import "@fontsource/zalando-sans/latin-400.css";
import "@fontsource/zalando-sans/latin-600.css";
import "@fontsource/zalando-sans/latin-700.css";
import "@fontsource/zalando-sans/latin-800.css";
import "@fontsource/zalando-sans/latin-900.css";
import { useEffect } from "react";
import { seasonalThemeForDate } from "../lib/seasonal-theme";

export default function App({ Component, pageProps }) {
  useEffect(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get("season") || "";
    const developmentOverride =
      process.env.NODE_ENV === "development" &&
      ["sinterklaas", "kerst", "pasen"].includes(requestedTheme)
        ? requestedTheme
        : "";
    const theme = developmentOverride || seasonalThemeForDate();
    if (theme) document.documentElement.dataset.season = theme;
    else delete document.documentElement.dataset.season;
    return () => {
      delete document.documentElement.dataset.season;
    };
  }, []);
  return (
    <div
      style={{
        "--font-body": "Inter, Calibri, sans-serif",
        "--font-heading": "Zalando Sans, Verdana, sans-serif",
        fontFamily: "var(--font-body)",
      }}
    >
      <style jsx global>{`
        button,
        input,
        select,
        textarea {
          font-family: var(--font-body);
        }
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-family: var(--font-heading);
        }
        [data-season="sinterklaas"] {
          --season-accent: #b45309;
          --season-accent-soft: #f59e0b;
          --season-ink: #7c2d12;
        }
        [data-season="kerst"] {
          --season-accent: #b91c1c;
          --season-accent-soft: #15803d;
          --season-ink: #7f1d1d;
        }
        [data-season="pasen"] {
          --season-accent: #7c3aed;
          --season-accent-soft: #ec4899;
          --season-ink: #5b21b6;
        }
        [data-season] body::before {
          content: "";
          pointer-events: none;
          position: fixed;
          inset: 0 0 auto;
          height: 4px;
          z-index: 9998;
          background: repeating-linear-gradient(
            90deg,
            var(--season-accent) 0 28px,
            var(--season-accent-soft) 28px 56px
          );
          box-shadow: 0 1px 5px color-mix(in srgb, var(--season-ink) 22%, transparent);
        }
        @media (max-width: 1500px) {
          .seasonal-header-decoration {
            display: none !important;
          }
        }
      `}</style>
      <Component {...pageProps} />
    </div>
  );
}
