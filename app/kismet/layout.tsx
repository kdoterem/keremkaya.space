import type { Metadata } from "next";

export const metadata: Metadata = {
  title:       "kismet — Believable Belief",
  description: "a weekly draw of three cards.",
};

export default function KismetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
