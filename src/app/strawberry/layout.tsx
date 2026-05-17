import type { Metadata } from "next";
import "./strawberry.css";

export const metadata: Metadata = {
  title: "strawberry",
  description: "heart.PROTOCOL_v2.0",
};

export default function StrawberryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="strawberry-root">{children}</div>;
}
