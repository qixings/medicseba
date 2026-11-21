import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useApi } from '@/lib/query';
import { shortDate, useT } from '@/lib/i18n';
import { C } from '@/lib/theme';
import type { Session } from '@/lib/types';
import { Calendar, monthOf, type DayMark } from './Calendar';
import { seatPill } from './cards';
import { Card, T, tap } from './ui';

const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Calendar plus the sittings of the chosen day, for moving a booking. */
export function SessionPicker({ doctorId, exclude, value, onChange }: { doctorId: string; exclude?: string; value: string | null; onChange: (id: string) => void }) {
  const t = useT();
  const [month, setMonth] = useState(monthOf(istToday()));
  const [date, setDate] = useState<string | null>(null);
  const cal = useApi<{ today: string; sessions: Session[] }>(`/doctors/${doctorId}/calendar?month=${month}`);
  const list = (cal.data?.sessions ?? []).filter((s) => s.id !== exclude && s.status !== 'CANCELLED');
  const marks = useMemo(() => {
    const m: Record<string, DayMark> = {};
    for (const s of list) m[s.date] = s.bookable || m[s.date] === 'open' ? 'open' : 'full';
    return m;
  }, [list]);
  const day = list.filter((s) => s.date === date);

  return (
    <>
      <Card style={{ padding: 14 }}>
        <Calendar month={month} today={cal.data?.today ?? istToday()} marks={marks} selected={date} onMonth={setMonth}
          onSelect={(d) => { setDate(d); const f = list.find((s) => s.date === d && s.bookable); if (f) onChange(f.id); }} />
      </Card>
      {date ? (
        <View style={{ marginTop: 12, gap: 8 }}>
          <T w="heavy" size={17}>{shortDate(t.lang, date)}</T>
          {day.map((s) => {
            const on = s.id === value;
            return (
              <Pressable key={s.id} disabled={!s.bookable} onPress={() => { tap(); onChange(s.id); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: C.white, borderWidth: on ? 2 : 1, borderColor: on ? C.brand : C.line, opacity: s.bookable ? 1 : 0.55 }}>
                <View style={{ flex: 1 }}>
                  <T numeric w="heavy" size={17}>{s.time}</T>
                  <T w="light" size={14} color={C.sec}>{s.chamber.name}</T>
                </View>
                {seatPill(t, s)}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </>
  );
}
