"use client";
import { useEffect, useRef } from "react";

export default function Starfield() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let stars = [];
    let raf;

    function size() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const count = Math.floor((window.innerWidth * window.innerHeight) / 4500);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.2,
        base: Math.random() * 0.5 + 0.15,
        speed: Math.random() * 0.015 + 0.003,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function draw(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#04060a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      stars.forEach((s) => {
        const tw = s.base + Math.sin(t * s.speed + s.phase) * 0.25;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(238,241,245,${Math.max(0, tw)})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    }

    size();
    window.addEventListener("resize", size);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);

  return <canvas id="stars" ref={canvasRef} />;
}
