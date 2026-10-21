"use client";
// Adapted from React Bits (https://reactbits.dev) BlurText — MIT + Commons Clause. Ported to JS.
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

const buildKeyframes = (from, steps) => {
  const keys = new Set([...Object.keys(from), ...steps.flatMap((s) => Object.keys(s))]);
  const keyframes = {};
  keys.forEach((k) => { keyframes[k] = [from[k], ...steps.map((s) => s[k])]; });
  return keyframes;
};

export default function BlurText({
  text = "",
  delay = 120,
  className = "",
  as: Tag = "span",
  animateBy = "words",
  direction = "top",
  threshold = 0.1,
  stepDuration = 0.35,
}) {
  const elements = animateBy === "words" ? text.split(" ") : text.split("");
  const [inView, setInView] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect(); }
    }, { threshold });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);

  const from = useMemo(
    () => ({ filter: "blur(10px)", opacity: 0, y: direction === "top" ? -30 : 30 }),
    [direction]
  );
  const to = useMemo(
    () => [
      { filter: "blur(5px)", opacity: 0.5, y: direction === "top" ? 4 : -4 },
      { filter: "blur(0px)", opacity: 1, y: 0 },
    ],
    [direction]
  );
  const keyframes = buildKeyframes(from, to);
  const times = [0, 0.5, 1];

  return (
    <Tag ref={ref} className={`blurText ${className}`}>
      {elements.map((segment, i) => (
        <motion.span
          key={`${segment}-${i}`}
          initial={from}
          animate={inView ? keyframes : from}
          transition={{ duration: stepDuration * 2, times, delay: (i * delay) / 1000 }}
          style={{ display: "inline-block", willChange: "transform, filter, opacity" }}
        >
          {segment === " " ? " " : segment}
          {animateBy === "words" && i < elements.length - 1 && " "}
        </motion.span>
      ))}
    </Tag>
  );
}
