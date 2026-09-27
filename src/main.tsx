import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { installIdleCursor } from "./lib/cursor"
import "./index.css"

if (import.meta.env.DEV && new URLSearchParams(location.search).has("preview")) {
  const { installPreview } = await import("./preview")
  installPreview()
}

installIdleCursor()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
