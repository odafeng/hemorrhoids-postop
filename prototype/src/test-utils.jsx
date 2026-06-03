/* eslint-disable react-refresh/only-export-components */
// Test utility: wraps components in QueryClientProvider + MemoryRouter
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,        // Don't retry in tests
        gcTime: 0,           // Don't cache between tests
        staleTime: 0,
      },
    },
  });
}

export function TestQueryWrapper({ children }) {
  const client = createTestQueryClient();
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}
