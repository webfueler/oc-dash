import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Widget } from "./components/Widget"
import { WIDGET_GLASS_DEFAULT, WIDGET_GLASS_VAR, widgetGlassAlpha } from "./widget"
import "./widget.css"

// The compact menu bar widget's own mount, same shape as
// src/main.tsx. The dashboard at / is untouched; this entry exists only for
// dist/widget.html, which the server answers at /widget.

// THE ONE OPTIONAL PARAMETER ON THIS ROUTE, and it is off unless it is asked
// for. `?glass=<0..1>` sets the panel's single ground dial for this page load,
// and the default is 0, which is the transparent panel that ships; at 1 it is
// the tinted panel this route used to serve, pixel for pixel. `widgetGlassAlpha`
// is the whole of the parsing and it lives in src/widget.ts so the node suite can
// pin it. Nothing is set when the value is the default, so the shipped URL never
// writes a style at all.
//
// It runs before the first render rather than in an effect, because a frame
// painted at the wrong alpha would be the one thing the Captain is looking at.
const glassAlpha = widgetGlassAlpha(window.location.search)
if (glassAlpha !== WIDGET_GLASS_DEFAULT) {
  document.documentElement.style.setProperty(WIDGET_GLASS_VAR, String(glassAlpha))
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Widget />
  </StrictMode>,
)