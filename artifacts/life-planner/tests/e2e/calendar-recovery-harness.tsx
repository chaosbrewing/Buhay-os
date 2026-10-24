import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CalendarPage from '../../src/CalendarPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <CalendarPage accountId="calendar-test-account" preferredCalendarId="team-calendar" onPreferredCalendarChange={() => undefined} />
  </QueryClientProvider>,
);
