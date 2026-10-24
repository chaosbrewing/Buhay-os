import React from 'react';
import WeekScreen from '@/app/(app)/(tabs)/week';

export default function NativeRecurrenceWeekFixture() {
  return <WeekScreen capturePathOverride="/__e2e__/recurrence/native/capture" />;
}
