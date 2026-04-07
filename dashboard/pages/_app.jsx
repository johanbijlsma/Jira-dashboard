import { Plus_Jakarta_Sans } from "next/font/google";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export default function App({ Component, pageProps }) {
  return (
    <div className={plusJakartaSans.variable}>
      <Component {...pageProps} />
    </div>
  );
}
