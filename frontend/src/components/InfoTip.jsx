import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css";

// Fixed bubble width — keep in sync with `.infotip-bubble { width }` in the
// CSS — and the minimum gap we hold between the bubble and the viewport edge.
const BUBBLE_W = 340;
const EDGE_MARGIN = 8;

export default function InfoTip({ text }) {
  const [pos, setPos] = useState(null);
  const iconRef = useRef(null);

  const show = () => {
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ cx: rect.left + rect.width / 2, top: rect.top });
  };

  const hide = () => setPos(null);

  // Clamp the bubble horizontally so it never runs off a viewport edge. It's
  // normally centered on the icon (left edge = cx − W/2), but for icons near
  // the right edge (e.g. the last column header) the centered bubble would
  // overflow and get clipped. When we shift it inward we also move the arrow
  // so it keeps pointing at the icon.
  let bubbleStyle = null;
  if (pos) {
    const idealLeft = pos.cx - BUBBLE_W / 2;
    const maxLeft = window.innerWidth - BUBBLE_W - EDGE_MARGIN;
    const left = Math.max(EDGE_MARGIN, Math.min(idealLeft, maxLeft));
    // Arrow position within the bubble, clamped off the rounded corners.
    const arrowX = Math.max(12, Math.min(pos.cx - left, BUBBLE_W - 12));
    bubbleStyle = { left, top: pos.top, "--arrow-x": `${arrowX}px` };
  }

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
        <div className="infotip-bubble" style={bubbleStyle}>
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
