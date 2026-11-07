// Lucide line icons (ISC), thinned to a 1.25 px stroke per brief §8.
import {
  Activity,
  Award,
  Brain,
  Code,
  ImagePlus,
  Network,
  Sigma,
  UserRound,
  Wrench,
  ArrowRight,
  Box,
  Copy,
  Expand,
  ExternalLink,
  FileText,
  FlaskConical,
  GitCommitVertical,
  LocateFixed,
  Mail,
  Map as MapIcon,
  Moon,
  NotebookPen,
  RotateCcw,
  RotateCw,
  Scan,
  Slice,
  Sun,
  ZoomIn,
  ZoomOut,
} from 'lucide-static';

const raw = {
  activity: Activity,
  award: Award,
  brain: Brain,
  code: Code,
  imagePlus: ImagePlus,
  network: Network,
  sigma: Sigma,
  user: UserRound,
  wrench: Wrench,
  arrowRight: ArrowRight,
  box: Box,
  copy: Copy,
  expand: Expand,
  externalLink: ExternalLink,
  fileText: FileText,
  flask: FlaskConical,
  commit: GitCommitVertical,
  locate: LocateFixed,
  mail: Mail,
  map: MapIcon,
  moon: Moon,
  notebook: NotebookPen,
  rotateCcw: RotateCcw,
  rotateCw: RotateCw,
  scan: Scan,
  slice: Slice,
  sun: Sun,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
};

export type IconName = keyof typeof raw;

export function icon(name: IconName): string {
  return raw[name]
    .replace(/<!--.*?-->/s, '')
    .replace('stroke-width="2"', 'stroke-width="1.25"')
    .replace(/\swidth="24"\s+height="24"/, ' width="16" height="16" aria-hidden="true" focusable="false"')
    .trim();
}
