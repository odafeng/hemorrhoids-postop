import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] || null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Reset localStorage before each test
beforeEach(() => { // eslint-disable-line no-undef
  localStorage.clear();
});

// Mock scrollIntoView — jsdom doesn't implement it
Element.prototype.scrollIntoView = vi.fn();
