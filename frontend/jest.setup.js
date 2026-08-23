require('@testing-library/jest-dom')
require('jest-axe/extend-expect')

// jsdom does not implement matchMedia — required by useMotionPreference,
// prefersReducedMotion(), and framer-motion internals.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

// jsdom origin is opaque — axe-core normalises colors against document color
// schemes and needs a real-ish origin to avoid "color-contrast" false majors.
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
  window.cancelAnimationFrame = () => {}
}
