import { useState, useRef } from "react";
import "./InfoTip.css"; // reuse the same bubble styles

/**
 * Wraps any children and shows a styled tooltip bubble on hover.
 * Uses position:fixed so it escapes table overflow clipping.
 */
export default function HoverTip({ children, content }) {
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);

  const show = () => {
    const rect = wrapRef.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: "inline-flex", alignItems: "center", cursor: "default" }}
      >
        {children}
      </span>
      {pos && (
        <div
          className="infotip-bubble"
          style={{ left: pos.x, top: pos.y, width: 240 }}
        >
          {content}
        </div>
      )}
    </>
  );
}
