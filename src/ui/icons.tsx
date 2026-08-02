/**
 * The app's icon vocabulary — Phosphor, matching the Figma design.
 *
 * Two rules:
 *  1. Icons come from `@phosphor-icons/react`. The Figma layers name their
 *     Phosphor counterparts exactly (`car-profile`, `gas-pump`, `house-line`,
 *     `airplane-tilt`, `fork-knife`, `piggy-bank`, `caret-left`,
 *     `calendar-dots`), so the mapping below is the design's own, not a guess.
 *  2. Imports are per-icon from `dist/csr/<Name>`, not from the barrel. The
 *     barrel pulls 9,000+ modules through the dev transform and makes Vite
 *     crawl for several seconds on every cold start.
 *
 * Category/pot icons are stored as string KEYS in Convex (`categories.icon`,
 * `pots.icon`, seeded by convex/lib/seed.ts). Those keys are data, so they must
 * stay stable — this file is the one place that turns a key into a glyph.
 */
import type { ComponentType } from 'react'
import { AirplaneTiltIcon } from '@phosphor-icons/react/dist/csr/AirplaneTilt'
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight'
import { BankIcon } from '@phosphor-icons/react/dist/csr/Bank'
import { BarbellIcon } from '@phosphor-icons/react/dist/csr/Barbell'
import { BasketIcon } from '@phosphor-icons/react/dist/csr/Basket'
import { CalendarDotsIcon } from '@phosphor-icons/react/dist/csr/CalendarDots'
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { CarProfileIcon } from '@phosphor-icons/react/dist/csr/CarProfile'
import { ChartPieSliceIcon } from '@phosphor-icons/react/dist/csr/ChartPieSlice'
import { DogIcon } from '@phosphor-icons/react/dist/csr/Dog'
import { FlowerIcon } from '@phosphor-icons/react/dist/csr/Flower'
import { ForkKnifeIcon } from '@phosphor-icons/react/dist/csr/ForkKnife'
import { GasPumpIcon } from '@phosphor-icons/react/dist/csr/GasPump'
import { GiftIcon } from '@phosphor-icons/react/dist/csr/Gift'
import { HouseLineIcon } from '@phosphor-icons/react/dist/csr/HouseLine'
import { LightbulbIcon } from '@phosphor-icons/react/dist/csr/Lightbulb'
import { PiggyBankIcon } from '@phosphor-icons/react/dist/csr/PiggyBank'
import { PlusIcon as PhPlusIcon } from '@phosphor-icons/react/dist/csr/Plus'
import { RepeatIcon } from '@phosphor-icons/react/dist/csr/Repeat'
import { ShoppingBagIcon } from '@phosphor-icons/react/dist/csr/ShoppingBag'
import { StarIcon } from '@phosphor-icons/react/dist/csr/Star'
import { SuitcaseIcon } from '@phosphor-icons/react/dist/csr/Suitcase'
import { WalletIcon } from '@phosphor-icons/react/dist/csr/Wallet'

type PhosphorIcon = ComponentType<{
  size?: number | string
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  color?: string
  className?: string
  'aria-hidden'?: boolean
}>

/** Stored icon key → Phosphor glyph. Keys are persisted data; never rename. */
const CATEGORY_ICONS: Record<string, PhosphorIcon> = {
  wallet: WalletIcon,
  basket: BasketIcon,
  bulb: LightbulbIcon,
  home: HouseLineIcon,
  car: CarProfileIcon,
  fuel: GasPumpIcon,
  flower: FlowerIcon,
  dumbbell: BarbellIcon,
  paw: DogIcon,
  utensils: ForkKnifeIcon,
  plane: AirplaneTiltIcon,
  gift: GiftIcon,
  star: StarIcon,
  bank: BankIcon,
  piggy: PiggyBankIcon,
  bag: ShoppingBagIcon,
  suitcase: SuitcaseIcon,
}

/** Every selectable icon key, for the pickers. */
export const ICON_KEYS = Object.keys(CATEGORY_ICONS)

/**
 * A category or pot icon, resolved from its stored key.
 *
 * Falls back to Star rather than rendering nothing: an unknown key means data
 * written by an older build, and a missing glyph would silently break the row's
 * alignment.
 */
export function CategoryIcon({
  icon,
  size = 20,
  className,
  color,
}: {
  icon: string | undefined
  size?: number
  className?: string
  color?: string
}) {
  const Glyph = (icon && CATEGORY_ICONS[icon]) || StarIcon
  return (
    <Glyph
      size={size}
      color={color ?? 'currentColor'}
      className={className}
      aria-hidden
    />
  )
}

// Shell icons, re-exported under the names the app already uses so the design's
// caret/calendar shapes replace the hand-drawn chevrons.
export {
  CaretLeftIcon,
  CaretRightIcon,
  CalendarDotsIcon,
  RepeatIcon,
  ChartPieSliceIcon,
  ArrowRightIcon,
}

export function PlusIcon({ className }: { className?: string }) {
  return <PhPlusIcon className={className} aria-hidden />
}
