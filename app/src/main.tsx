import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import "./index.css"

// Follow the system appearance; the dark tokens in index.css hang off the .dark class
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")
const applyScheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches)
applyScheme()
darkQuery.addEventListener("change", applyScheme)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
