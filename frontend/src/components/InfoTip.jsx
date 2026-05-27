import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css";

export default function InfoTip({ text }) {
  const [pos, setPos] = useState(null);
  const iconRef = useRef(null);

  const show = () => {
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
  };

  const hide = () => setPos(null);

  // Render the bubble via a portal attached to document.body so it
  // escapes any parent's opacity / transform / overflow context. Without
  // this, hovering an InfoTip inside (e.g.) a row with opacity: 0.55
  // would render a translucent bubble whose text bleeds through onto
  // the row underneath. The portal renders the bubble as a top-level
  // sibling of <body>, fully opaque regardless of where its trigger
  // icon lives in the DOM tree.
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
      {pos && createPortal(
        <div
          className="infotip-bubble"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
