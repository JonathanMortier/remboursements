import {
  Camera,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  createElement,
  Euro,
  Eye,
  EyeOff,
  Image,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Settings,
  Sun,
  X,
  type IconNode,
} from 'lucide';

/** Jeu d'icônes SVG unique (Lucide), identique sur iPhone et Android. */
export const icons = {
  camera: Camera,
  calendar: CalendarDays,
  check: Check,
  prev: ChevronLeft,
  next: ChevronRight,
  euro: Euro,
  eye: Eye,
  eyeOff: EyeOff,
  image: Image,
  auto: Monitor,
  moon: Moon,
  plus: Plus,
  refresh: RefreshCw,
  settings: Settings,
  sun: Sun,
  x: X,
} satisfies Record<string, IconNode>;

export function icon(name: keyof typeof icons, size = 20): SVGElement {
  const svg = createElement(icons[name], { width: size, height: size, 'stroke-width': 2, 'aria-hidden': 'true' });
  svg.classList.add('ic');
  return svg;
}
