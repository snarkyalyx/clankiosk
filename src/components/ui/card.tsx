import * as React from "react"
import { cn } from "@/lib/utils"

// Surfaces are separated by shadow, not by a border: one hairline drop in the
// top 2px plus a wide soft halo, which is the whole depth system on this panel.
function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-card text-card-foreground",
        "shadow-[0_1px_2px_rgba(0,0,0,0.35),0_10px_30px_-16px_rgba(0,0,0,0.85)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
}
function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
}
function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />
}
function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />
}
function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />
}
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
