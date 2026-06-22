"use client";
import { useEffect, useRef } from "react";

export default function WaveDivider() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf;

    function size() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height || 34;
    }

    function draw(t) {
      size();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const colors = ["#3d7fff", "#00cfdd", "#7c5cfc"];
      const w = canvas.width, h = canvas.height;
      colors.forEach((c, ci) => {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y = h / 2 + Math.sin(x * 0.045 + t * 0.0016 + ci * 2) * (h / 2 - 3) * 0.6;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas className="waveDivider" ref={canvasRef} />;
}
