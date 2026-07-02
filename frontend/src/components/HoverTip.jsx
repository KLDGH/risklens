import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css"; // reuse the same bubble styles

const EDGE_MARGIN = 8;

/**
 * Wraps any children and shows a styled tooltip bubble on hover.
 *
 * Shares InfoTip's positioning: the bubble is portaled to <body> (so it
 * escapes table overflow/opacity contexts) and its left edge is clamped to
 * the viewport, with the arrow tracked back to the trigger. Only the width
 * differs from InfoTip (variable here vs a fixed 340).
 */
export default function HoverTip({ children, content, block = false, width = 240 }) {
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);

  const show = () => {
    const rect = wrapRef.current.getBoundingClientRect();
    setPos({ cx: rect.left + rect.width / 2, top: rect.top });
  };

  const hide = () => setPos(null);

  const Wrap = block ? "div" : "span";
  const wrapStyle = block
    ? { display: "block", cursor: "default" }
    : { display: "inline-flex", alignItems: "center", cursor: "default" };

  let bubbleStyle = null;
  if (pos) {
    const idealLeft = pos.cx - width / 2;
    const maxLeft = window.innerWidth - width - EDGE_MARGIN;
    const left = Math.max(EDGE_MARGIN, Math.min(idealLeft, maxLeft));
    const arrowX = Math.max(12, Math.min(pos.cx - left, width - 12));
    bubbleStyle = { left, top: pos.top, width, "--arrow-x": `${arrowX}px` };
  }

  return (
    <>
      <Wrap
        ref={wrapRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={wrapStyle}
      >
        {children}
      </Wrap>
      {pos && createPortal(
        <div className="infotip-bubble" style={bubbleStyle}>
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
