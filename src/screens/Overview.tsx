import { usePeriod } from '../period/PeriodContext'
import { PeriodHeading } from '../app/PeriodHeading'
import { YearView } from './YearView'
import { MonthView } from './MonthView'

/**
 * The single overview. The period control's granularity decides which zoom
 * level shows — year (net worth) or month (income / spending). This is the
 * whole app's navigation.
 */
export function Overview() {
  const { granularity } = usePeriod()
  return (
    <>
      <PeriodHeading />
      {granularity === 'year' ? <YearView /> : <MonthView />}
    </>
  )
}
