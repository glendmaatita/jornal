import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-[filter,background-color,border-color,box-shadow,transform] outline-none focus-visible:ring-2 focus-visible:ring-[#16579d]/40 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(91.28deg,#97daff_0%,#16579d_100%)] text-white shadow-sm hover:brightness-105",
        secondary: "bg-[#f1f5fd] text-[var(--main-dark)] border border-[#ced6e1] hover:bg-[#e8eefc]",
        outline: "border border-[#ced6e1] bg-white hover:bg-[#f1f5fd] hover:text-[var(--main-dark)]",
        ghost: "hover:bg-white hover:text-[var(--main-dark)]",
        destructive: "bg-destructive text-white hover:brightness-105",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-[50px] px-6 text-base",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
