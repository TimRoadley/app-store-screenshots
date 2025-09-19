export interface FrameSettings {
  imageBorderRadius: number;
  frameBorderRadius: number;
  /**
   * Uniform margin (in px) between the device outer edge and the screen cutout.
   * If set, this value takes precedence over screenshotOffset and framePadding
   * for positioning and frame sizing.
   */
  edgeMargin?: number;
  framePadding: {
    horizontal: number;
    vertical: number;
  };
  screenshotOffset: {
    top: number;
    left: number;
  };
  homeIndicator: {
    width: number;
    height: number;
    borderRadius: number;
    opacity: number;
  };
  shadow: {
    dx: number;
    dy: number;
    stdDeviation: number;
    opacity: number;
  };
}

export const defaultFrameSettings: FrameSettings = {
  imageBorderRadius: 110,
  frameBorderRadius: 140,
  edgeMargin: 30,
  framePadding: {
    horizontal: 90, // Horizontal padding for frame (left+right = 80 -> 40 each)
    vertical: 90   // Vertical padding for frame (top+bottom = 80 -> 40 each)
  },
  screenshotOffset: {
    top: 40,  // Top offset for screenshot positioning (match side gap)
    left: 40  // Left offset for screenshot positioning
  },
  homeIndicator: {
    width: 200,
    height: 6,
    borderRadius: 3,
    opacity: 0.8
  },
  shadow: {
    dx: 0,
    dy: 4,
    stdDeviation: 8,
    opacity: 0.3
  }
};
