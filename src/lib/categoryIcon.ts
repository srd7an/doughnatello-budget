/**
 * Category/pot icon keys → emoji, a stand-in until the real icon set arrives
 * with the Figma design. Keys match what seed.ts and the create forms store.
 */
const MAP: Record<string, string> = {
  wallet: '👛',
  basket: '🧺',
  bulb: '💡',
  home: '🏠',
  car: '🚗',
  fuel: '⛽',
  flower: '🌼',
  dumbbell: '🏋️',
  paw: '🐾',
  utensils: '🍴',
  plane: '✈️',
  gift: '🎁',
  star: '⭐',
  bank: '🏦',
  piggy: '🐷',
}

export function categoryEmoji(icon: string | undefined): string {
  return (icon && MAP[icon]) || '•'
}
