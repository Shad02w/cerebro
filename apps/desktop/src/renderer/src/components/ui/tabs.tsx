import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'

import { cn } from '@/lib/utils'

function Tabs({
  className,
  orientation = 'horizontal',
  ...props
}: TabsPrimitive.Root.Props): React.JSX.Element {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none data-[variant=pill]:rounded-none data-[variant=pill]:p-0',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
        pill: 'gap-1 bg-transparent'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>): React.JSX.Element {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

const tabsTriggerVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-1.5 border border-transparent font-medium whitespace-nowrap transition-all',
    'group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start',
    'hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
  ],
  {
    variants: {
      variant: {
        default: [
          'h-[calc(100%-1px)] flex-1 rounded-md px-2 py-1 text-sm text-foreground/60',
          'dark:text-muted-foreground dark:hover:text-foreground',
          'group-data-[variant=default]/tabs-list:data-active:shadow-sm',
          'data-active:bg-background data-active:text-foreground',
          'dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground'
        ],
        line: [
          'h-[calc(100%-1px)] flex-1 rounded-md px-2 py-1 text-sm text-foreground/60',
          'dark:text-muted-foreground dark:hover:text-foreground',
          'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:shadow-none',
          'dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
          'data-active:bg-background data-active:text-foreground',
          'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity',
          'group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5',
          'group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5',
          'group-data-[variant=line]/tabs-list:data-active:after:opacity-100'
        ],
        pill: [
          'h-7 max-w-48 min-w-0 shrink-0 justify-start rounded-md px-2.5 py-1 text-xs text-muted-foreground',
          'data-active:bg-muted data-active:text-foreground data-active:shadow-none',
          'bg-transparent hover:text-foreground',
          'dark:data-active:border-transparent dark:data-active:bg-muted'
        ]
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function TabsTrigger({
  className,
  variant = 'default',
  ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTriggerVariants>): React.JSX.Element {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props): React.JSX.Element {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants, tabsTriggerVariants }
