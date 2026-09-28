import { render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { describe, expect, it, vi } from 'vitest';
import { ErrorScreen } from './ErrorScreen';

function Broken(): never {
  throw new Error('boom');
}

describe('ErrorScreen', () => {
  it('replaces a crashed screen with a way to recover', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const router = createMemoryRouter([
      { ErrorBoundary: ErrorScreen, children: [{ path: '/', Component: Broken }] },
    ]);

    render(<RouterProvider router={router} />);

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Screen crashed', expect.any(Error));
  });
});
