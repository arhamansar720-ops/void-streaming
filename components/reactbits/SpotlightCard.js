"use client";
// Adapted from React Bits (https://reactbits.dev) SpotlightCard — MIT + Commons Clause.
// A radial glow follows the cursor. Styles live in globals.css (.spotlightCard).
import { useRef } from "react";

export default function SpotlightCard({ as: Tag = "div", children, className = "", spotlightColor = "rgba(0, 207, 221, 0.18)", ...rest }) {
  const ref = useRef(null);
  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    ref.current.style.setProperty("--mouse-x", `${e.clientX - rect.left}px`);
    ref.current.style.setProperty("--mouse-y", `${e.clientY - rect.top}px`);
    ref.current.style.setProperty("--spotlight-color", spotlightColor);
  }
  return (
    <Tag ref={ref} onMouseMove={onMove} className={`spotlightCard ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
