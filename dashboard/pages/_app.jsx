import { Inter, Zalando_Sans_SemiExpanded } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  fallback: ["Calibri", "sans-serif"],
});

const zalandoSansSemiExpanded = Zalando_Sans_SemiExpanded({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-zalando-semi-expanded",
  fallback: ["Verdana", "sans-serif"],
});

export default function App({ Component, pageProps }) {
  return (
    <div
      className={`${inter.variable} ${zalandoSansSemiExpanded.variable}`}
      style={{
        "--font-body": "var(--font-inter), Calibri, sans-serif",
        "--font-heading": "var(--font-zalando-semi-expanded), Verdana, sans-serif",
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
      `}</style>
      <Component {...pageProps} />
    </div>
  );
}
