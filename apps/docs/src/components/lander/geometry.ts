// Shared geometry for the landing's ring diagrams. Angles are in degrees,
// 0 = right, increasing clockwise (SVG y points down).

export const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
};

export const fix = (n: number) => n.toFixed(1);

// The hero board: a 1160-unit square centred on the hub.
export const VIEW = 1160;
export const R_MACHINE = 392;
export const R_BAND = R_MACHINE + 15;
export const R_LABEL = 494;
export const R_HUB = 46;

// Six people evenly around the ring; "you" sits at the bottom, between two of
// them. Every track bends the same way, so no two tracks ever cross.
export const OUTER = [-60, 0, 60, 120, 180, 240];
export const BEND = 14;
export const YOU = 90;
export const BUNDLE = [-15, -9, -3, 3, 9, 15];
// Ring labels sit at the top, midway between the two upper people, so they
// clear both names at every board size.
export const LABEL_DEG = -90;

export const trackPath = (origin: number, bend = BEND) => {
  const [x0, y0] = polar(R_MACHINE, origin);
  const [cx, cy] = polar(236, origin + bend);
  const [x1, y1] = polar(R_HUB + 4, origin + bend * 1.6);
  return `M${fix(x0)} ${fix(y0)} Q${fix(cx)} ${fix(cy)} ${fix(x1)} ${fix(y1)}`;
};

// A wedge drawn at 0deg; the page rotates it to its owner's origin.
export const wedgePath = (r0: number, r1: number, span: number) => {
  const [ax, ay] = polar(r0, -span);
  const [bx, by] = polar(r1, -span);
  const [cx, cy] = polar(r1, span);
  const [dx, dy] = polar(r0, span);
  return `M${fix(ax)} ${fix(ay)} L${fix(bx)} ${fix(by)} A${r1} ${r1} 0 0 1 ${fix(cx)} ${fix(cy)} L${fix(dx)} ${fix(dy)} A${r0} ${r0} 0 0 0 ${fix(ax)} ${fix(ay)}Z`;
};

export const toPercent = (r: number, deg: number) => {
  const [x, y] = polar(r, deg);
  return { left: 50 + (x / VIEW) * 100, top: 50 + (y / VIEW) * 100 };
};
