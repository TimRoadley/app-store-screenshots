import path from 'path';

export interface CombineSettings {
  backgroundPath: string;
  framedScreenshotsPath: string;
  spacing: number;
  deviceType: 'iphone' | 'ipad';
  locale: string;
  titleFontSize: number;
  titleColor: string;
  titleShadowColor: string;
  titleShadowOffset: number;
  titleSpacing: number;
  centerInQuarters: boolean;
  iPhoneScaleFactor: number;
  iPadScaleFactor: number;
}

export const defaultSettings: CombineSettings = {
  backgroundPath: path.resolve(__dirname, '../00_input/background/bg.png'),
  framedScreenshotsPath: path.resolve(__dirname, '../01_input_framed/framed_screenshots'),
  spacing: 50,
  deviceType: 'iphone',
  locale: 'en',
  titleFontSize: 130,
  titleColor: '#ffffff',
  titleShadowColor: '#000000',
  titleShadowOffset: 1,
  titleSpacing: 100,
  centerInQuarters: true,
  iPhoneScaleFactor: 0.9,
  iPadScaleFactor: 0.86
};
