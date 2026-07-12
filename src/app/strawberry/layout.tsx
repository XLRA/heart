import type { Metadata } from "next";
import "./strawberry.css";

export const metadata: Metadata = {
  title: "strawberry",
  description: "nothing to see here",
};

export default function StrawberryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="strawberry-root">{children}</div>;
}
