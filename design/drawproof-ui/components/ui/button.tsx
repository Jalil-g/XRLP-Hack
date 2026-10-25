import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border text-[15px] font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-[#253534]',
        outline: 'border-control bg-white text-ink hover:bg-accent',
        secondary: 'border-control bg-white text-ink hover:bg-accent',
        ghost: 'border-transparent text-ink hover:bg-accent',
        destructive: 'border-transparent bg-bad text-white hover:bg-bad/90',
        link: 'border-transparent px-0 text-ink underline underline-offset-4 hover:no-underline',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 px-3 text-sm',
        xs: 'h-7 px-2 text-[13px]',
        lg: 'h-12 px-5',
        icon: 'size-9',
        'icon-sm': 'size-7',
        'icon-xs': 'size-6',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
