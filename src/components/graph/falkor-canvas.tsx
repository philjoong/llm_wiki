import { useEffect, useRef, useState } from "react"
import type { CanvasData } from "@/lib/falkor-visualization"

interface FalkorCanvasProps {
  data: CanvasData
  onNodeClick?: (node: any) => void
  onLinkClick?: (link: any) => void
  backgroundColor?: string
  foregroundColor?: string
}

export function FalkorCanvas({
  data,
  onNodeClick,
  onLinkClick,
  backgroundColor = "transparent",
  foregroundColor = "currentColor",
}: FalkorCanvasProps) {
  const canvasRef = useRef<any>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Dynamic import of the web component
    import("@falkordb/canvas")
      .then(() => setLoaded(true))
      .catch((err) => console.error("Failed to load @falkordb/canvas", err))
  }, [])

  useEffect(() => {
    if (loaded && canvasRef.current) {
      const canvas = canvasRef.current
      
      // Map data to the internal format expected by falkordb-canvas
      // Actually, falkordb-canvas expects exactly the format we have in CanvasData
      // but it needs them in the 'data' property of setData call?
      // According to npm info: canvas.setData({ nodes: [...], links: [...] });
      canvas.setData(data)

      canvas.setConfig({
        backgroundColor,
        foregroundColor,
        onNodeClick,
        onLinkClick,
        // Disable CRUD interactions
        isReadOnly: true,
      })
    }
  }, [loaded, data, onNodeClick, onLinkClick, backgroundColor, foregroundColor])

  const CanvasElement = "falkordb-canvas" as any

  return (
    <div className="h-full w-full overflow-hidden">
      <CanvasElement ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  )
}
