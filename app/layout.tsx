import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "podbench / agent environment fleet",
  description:
    "Deterministic, resettable task environments for LLM agents with a programmatic verifier, run at fleet scale with per-run token metering and pod-health observability.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
