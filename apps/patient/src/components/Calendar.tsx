import { Pressable, View } from 'react-native';
import { C } from '@/lib/theme';
import { dayName, monthName, useT } from '@/lib/i18n';
import { Icon } from './Icon';
import { T, tap } from './ui';

export type DayMark = 'open' | 'full' | 'none';

const pad = (n: number) => String(n).padStart(2, '0');
export const monthOf = (date: string) => date.slice(0, 7);
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Month grid. Days with a sitting get a dot; full days a grey dot. */
export function Calendar({ month, today, marks, selected, onSelect, onMonth, maxDate }: {
  month: string; today: string; marks: Record<string, DayMark>; selected: string | null;
  onSelect: (date: string) => void; onMonth: (m: string) => void; maxDate?: string;
}) {
  const t = useT();
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const canPrev = month > monthOf(today);
  const canNext = !maxDate || month < monthOf(maxDate);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <T w="heavy" size={18}>{monthName(t.lang, m)} <T w="light" size={18} color={C.sec}>{y}</T></T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[[-1, canPrev, 'back'], [1, canNext, 'chev']].map(([by, ok, ic]) => (
            <Pressable key={String(by)} accessibilityLabel={by === -1 ? 'Previous month' : 'Next month'} disabled={!ok} onPress={() => { tap(); onMonth(shiftMonth(month, by as number)); }}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', opacity: ok ? 1 : 0.35 }}>
              <Icon name={ic as 'back'} size={17} width={2.6} />
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {[0, 1, 2, 3, 4, 5, 6].map((d) => (
          <T key={d} w="bold" size={11} color={C.faint} style={{ flex: 1, textAlign: 'center', marginBottom: 4 }}>{dayName(t.lang, d)}</T>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row' }}>
          {cells.slice(r * 7, r * 7 + 7).map((date, i) => {
            if (!date) return <View key={i} style={{ flex: 1, height: 40 }} />;
            const mark = marks[date] ?? 'none';
            const past = date < today;
            const on = date === selected;
            const disabled = past || mark === 'none';
            return (
              <Pressable key={date} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on, disabled }} accessibilityLabel={date}
                onPress={() => { tap(); onSelect(date); }} style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.brand : 'transparent', borderWidth: date === today && !on ? 1.5 : 0, borderColor: C.brand }}>
                  <T numeric w={on || mark === 'open' ? 'heavy' : 'regular'} size={15} color={on ? C.white : disabled ? 'rgba(11,18,32,0.3)' : C.ink}>{Number(date.slice(8))}</T>
                  {mark !== 'none' && !past ? <View style={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: on ? C.white : mark === 'open' ? C.brand : 'rgba(11,18,32,0.25)' }} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
