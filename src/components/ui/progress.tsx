import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number | null
  indicatorClassName?: string
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, indicatorClassName, ...props }, ref) => {
    const pct = value == null ? 0 : Math.min(100, Math.max(0, value))
    return (
      <div
        ref={ref}
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
        {...props}
      >
        <div
          className={cn("h-full rounded-full bg-primary transition-all duration-700", indicatorClassName)}
          style={{ width: `${pct}%` }}
        />
      </div>
    )
  },
)
Progress.displayName = "Progress"
export { Progress }
