import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none",
    "transition-[background-color,color,box-shadow,transform] duration-150 ease-out",
    "active:translate-y-px disabled:pointer-events-none disabled:opacity-55",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-foreground shadow-sm hover:bg-accent-hover [box-shadow:inset_0_1px_0_oklch(1_0_0/0.18),var(--aq-shadow-sm)]",
        secondary:
          "border border-border bg-surface text-foreground shadow-sm hover:border-border-strong hover:bg-surface-sunken",
        ghost: "text-foreground-muted hover:bg-surface-sunken hover:text-foreground",
        danger: "bg-danger text-danger-foreground shadow-sm hover:bg-danger-hover",
        link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
      },
      size: {
        // Every size keeps a ≥ 44px hit area on touch devices (WCAG 2.5.8 / §8).
        sm: "h-9 px-3 text-sm pointer-coarse:h-11",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}
