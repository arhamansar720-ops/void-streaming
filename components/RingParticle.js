"use client";
import { useEffect, useRef } from "react";

const COLORS = ["#3d7fff", "#7c5cfc", "#00cfdd", "#ff5533"];

export default function RingParticle() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let particles = [];
    let raf;

    function size() {
      const rect = wrapRef.current.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      const n = 90;
      const R = Math.min(rect.width, rect.height) * 0.36;
      particles = Array.from({ length: n }, (_, i) => ({
        angle: (i / n) * Math.PI * 2,
        radius: R + (Math.random() - 0.5) * 18,
        speed: (Math.random() * 0.0025 + 0.0014) * (i % 2 === 0 ? 1 : -1),
        size: Math.random() * 1.8 + 0.7,
        color: COLORS[i % COLORS.length],
        wob: Math.random() * Math.PI * 2,
      }));
    }

    function draw(t) {
      if (!canvas.width) { raf = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2, cy = canvas.height / 2;
      particles.forEach((p) => {
        p.angle += p.speed;
        const wob = Math.sin(t * 0.001 + p.wob) * 6;
        const x = cx + Math.cos(p.angle) * (p.radius + wob);
        const y = cy + Math.sin(p.angle) * (p.radius + wob);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.35;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    size();
    window.addEventListener("resize", size);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);

  return (
    <div className="ringWrap" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
