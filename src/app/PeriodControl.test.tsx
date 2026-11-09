import { describe, expect, test } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScreen } from '../test/render'
import { PeriodControl } from './PeriodControl'
import { PeriodHeading } from './PeriodHeading'

/**
 * The period is the app's whole navigation, so the claims here are about
 * getting somewhere: any month in one press, the year and back without losing
 * your place. Both used to be a menu and an arrow pressed nine times.
 */
const nav = (route: string) =>
  renderScreen(
    <>
      <PeriodHeading />
      <PeriodControl />
    </>,
    { route },
  )

const heading = () => screen.getByRole('heading', { level: 1 })

describe('the period control', () => {
  test('the picker goes straight to a month', async () => {
    nav('/?p=2026-11')
    expect(heading()).toHaveTextContent('November 2026')

    await userEvent.click(screen.getByRole('button', { name: /choose a period/i }))
    const picker = screen.getByRole('dialog', { name: /choose a period/i })
    // The month on screen is the one marked.
    expect(
      // "…, this month" is appended when the test happens to run in it.
      within(picker).getByRole('button', { name: /^November 2026/ }),
    ).toHaveAttribute('aria-current', 'date')

    await userEvent.click(within(picker).getByRole('button', { name: 'February 2026' }))
    expect(heading()).toHaveTextContent('February 2026')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('turning the picker to another year moves nothing until a month is chosen', async () => {
    nav('/?p=2026-11')
    await userEvent.click(screen.getByRole('button', { name: /choose a period/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(heading()).toHaveTextContent('November 2026')

    await userEvent.click(screen.getByRole('button', { name: 'March 2025' }))
    expect(heading()).toHaveTextContent('March 2025')
  })

  test('the picker opens the whole year', async () => {
    nav('/?p=2026-11')
    await userEvent.click(screen.getByRole('button', { name: /choose a period/i }))
    await userEvent.click(screen.getByRole('button', { name: 'All of 2026' }))
    expect(heading()).toHaveTextContent(/^2026$/)
  })

  test('zooming out and back in returns to the month you left', async () => {
    // Not today's month of that year, which is where it used to land.
    nav('/?p=2025-03')
    await userEvent.click(screen.getByRole('button', { name: 'year' }))
    expect(heading()).toHaveTextContent(/^2025$/)
    expect(screen.getByRole('button', { name: 'year' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'month' }))
    expect(heading()).toHaveTextContent('March 2025')
  })

  test('the arrows sit either side of the name and step it', async () => {
    nav('/?p=2026-12')
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }))
    expect(heading()).toHaveTextContent('January 2027')
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(heading()).toHaveTextContent('December 2026')
  })
})
