import { useState, useRef } from "react";
import "./InfoTip.css";

export default function InfoTip({ text }) {
  const [pos, setPos] = useState(null);
  const iconRef = useRef(null);

  const show = () => {
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={iconRef}
        className="infotip-icon"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        ⓘ
      </span>
      {pos && (
        <div
          className="infotip-bubble"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </div>
      )}
    </>
  );
}
