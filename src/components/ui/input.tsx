import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-hairline bg-surface px-2.5 text-sm text-text",
        "placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-hairline bg-surface p-3 font-mono text-sm leading-relaxed text-text",
      "placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 rounded-md border border-hairline bg-surface px-2 text-sm text-text",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export { Input, Select, Textarea };
