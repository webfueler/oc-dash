import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Widget } from "./components/Widget"
import "./widget.css"

// The compact menu bar widget's own mount, same shape as
// src/main.tsx. The dashboard at / is untouched; this entry exists only for
// dist/widget.html, which the server answers at /widget.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Widget />
  </StrictMode>,
)
