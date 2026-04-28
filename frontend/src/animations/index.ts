// Animation components
export { Ripple } from '../components/animations/Ripple'
export {
  ScrollReveal,
  GestureCard as AdvancedGestureCard,
  LoadingPulse,
  SuccessFlare,
  ErrorShake,
  StaggerGrid,
  CountUp,
} from '../components/animations/AdvancedAnimationSystem'
export { GestureCard } from '../components/GestureCard'
export {
  PageTransition,
  FadeIn,
  StaggeredList,
  StaggeredItem,
} from '../components/PageTransition'
export { SuccessAnimation } from '../components/feedback/SuccessAnimation'
export { ErrorAnimation } from '../components/feedback/ErrorAnimation'

// Hooks
export { useMotionPreference } from '../hooks/useMotionPreference'
export { useRipple } from '../hooks/useRipple'
export { useStaggeredAnimation } from '../hooks/useStaggeredAnimation'

// Variants & utilities
export {
  fadeInVariants,
  fadeInUpVariants,
  scaleInVariants,
  slideInRightVariants,
  pageTransitionVariants,
  staggerContainerVariants,
  listItemVariants,
  hoverScaleVariants,
  pulseVariants,
  spinVariants,
  shakeVariants,
  bounceInVariants,
  transitions,
  springs,
  prefersReducedMotion,
  getAnimationProps,
  animationClasses,
  transitionClasses,
  hoverClasses,
} from '../utils/animations'
