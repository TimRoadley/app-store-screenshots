import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { readdir } from 'fs/promises';
import { defaultFrameSettings, FrameSettings } from './settings';

// Sharp performance optimizations for 24-core system
sharp.concurrency(2); // Limit internal thread pool to avoid oversubscription
sharp.cache(false); // Disable cache for better memory usage with large batches

// Batch processing configuration
const FRAMER_BATCH_SIZE = 32; // 32 parallel operations for 24-core system

interface FrameOptions {
  inputPath: string;
  outputPath?: string;
  deviceType?: 'iphone' | 'ipad';
  settings?: Partial<FrameSettings>;
}

/**
 * Creates a framed screenshot by compositing the input image onto an iPhone device frame
 */
async function frameScreenshot(options: FrameOptions): Promise<string> {
  const { inputPath, deviceType = 'iphone', settings = {} } = options;

  // Merge provided settings with defaults
  const frameSettings: FrameSettings = { ...defaultFrameSettings, ...settings };

  // Generate output path if not provided
  const outputPath = options.outputPath || generateOutputPath(inputPath);

  try {
    // Load the input screenshot with performance optimizations
    const inputImage = sharp(inputPath, {
      failOnError: false,
      limitInputPixels: false
    });
    const inputMetadata = await inputImage.metadata();

    console.log(`Processing screenshot: ${inputPath}`);
    console.log(`Input dimensions: ${inputMetadata.width}x${inputMetadata.height}`);

    // Create background and device bezels separately
    const backgroundBuffer = await createDeviceBackground(inputMetadata.width!, inputMetadata.height!, deviceType, frameSettings);
    const bezelsBuffer = await createDeviceBezels(inputMetadata.width!, inputMetadata.height!, deviceType, frameSettings);

    // Apply border radius using a mask via Sharp compositing (avoids huge inline SVG data URIs)
    let roundedScreenshot: Buffer;

    if (frameSettings.imageBorderRadius > 0) {
      // Create a simple SVG mask with rounded rectangle
      const maskSvg = `
        <svg width="${inputMetadata.width}" height="${inputMetadata.height}" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="100%" height="100%" rx="${frameSettings.imageBorderRadius}" ry="${frameSettings.imageBorderRadius}" fill="#ffffff"/>
        </svg>
      `;

      // Apply mask using destination-in blend
      roundedScreenshot = await inputImage
        .composite([
          { input: Buffer.from(maskSvg), blend: 'dest-in' }
        ])
        .png()
        .toBuffer();
    } else {
      // No border radius, use original image
      roundedScreenshot = await inputImage.png().toBuffer();
    }

    // Layer: Background -> Screenshot -> Bezels
    const framedImage = await sharp(backgroundBuffer)
      .composite([
        {
          input: roundedScreenshot,
          top: getScreenshotOffset(deviceType, inputMetadata.width!, inputMetadata.height!, true, frameSettings),
          left: getScreenshotOffset(deviceType, inputMetadata.width!, inputMetadata.height!, false, frameSettings)
        },
        {
          input: bezelsBuffer,
          top: 0,
          left: 0
        }
      ])
      .png()
      .toBuffer();

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Save the framed image
    await sharp(framedImage).toFile(outputPath);

    console.log(`Framed screenshot saved to: ${outputPath}`);
    return outputPath;

  } catch (error) {
    console.error('Error framing screenshot:', error);
    throw error;
  }
}

/**
 * Creates the device background (shadow and screen area)
 */
async function createDeviceBackground(screenshotWidth: number, screenshotHeight: number, deviceType: string, settings: FrameSettings): Promise<Buffer> {
  // Frame dimensions (slightly larger than screenshot to accommodate the frame)
  const margin = typeof settings.edgeMargin === 'number' ? settings.edgeMargin : (settings.screenshotOffset?.left ?? defaultFrameSettings.screenshotOffset.left);
  const frameWidth = screenshotWidth + (margin * 2);
  const frameHeight = screenshotHeight + (margin * 2);

  const screenX = margin;
  const screenY = margin;

  // Create background and screen bed (no outer device yet)
  const backgroundSvg = `
    <svg width="${frameWidth}" height="${frameHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="screenGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#000000;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#0c0c0c;stop-opacity:1" />
        </linearGradient>
      </defs>

      <!-- Screen area (subtle dark base under the screenshot) -->
      <rect x="${screenX}" y="${screenY}" width="${screenshotWidth}" height="${screenshotHeight}"
            rx="${settings.imageBorderRadius}" ry="${settings.imageBorderRadius}" fill="url(#screenGradient)"/>

      <!-- Very subtle inner stroke to avoid aliasing at rounded corners -->
      <rect x="${screenX+0.5}" y="${screenY+0.5}" width="${screenshotWidth-1}" height="${screenshotHeight-1}"
            rx="${Math.max(0, settings.imageBorderRadius-0.5)}" ry="${Math.max(0, settings.imageBorderRadius-0.5)}" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
    </svg>
  `;

  return Buffer.from(backgroundSvg);
}

/**
 * Creates the device bezels (frame edges that sit on top of screenshot)
 */
async function createDeviceBezels(screenshotWidth: number, screenshotHeight: number, deviceType: string, settings: FrameSettings): Promise<Buffer> {
  // Frame dimensions (slightly larger than screenshot to accommodate the frame)
  const margin = typeof settings.edgeMargin === 'number' ? settings.edgeMargin : (settings.screenshotOffset?.left ?? defaultFrameSettings.screenshotOffset.left);
  const frameWidth = screenshotWidth + (margin * 2);
  const frameHeight = screenshotHeight + (margin * 2);

  const screenX = margin;
  const screenY = margin;

  // Create device bezels that will sit on top
  const bezelsSvg = `
    <svg width="${frameWidth}" height="${frameHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="${settings.shadow.dx}" dy="${settings.shadow.dy}" stdDeviation="${settings.shadow.stdDeviation}" flood-color="rgba(0,0,0,${settings.shadow.opacity})"/>
        </filter>
        <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#1b1b1b;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#0b0b0b;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="rimGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(255,255,255,0.35);stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgba(255,255,255,0.05);stop-opacity:1" />
        </linearGradient>
        <!-- Mask to cut out the screen area from the device body so bezels only surround the edges -->
        <mask id="bezelMask">
          <rect width="100%" height="100%" fill="white"/>
          <rect x="${screenX}" y="${screenY}" width="${screenshotWidth}" height="${screenshotHeight}"
                rx="${settings.imageBorderRadius}" ry="${settings.imageBorderRadius}" fill="black"/>
        </mask>
      </defs>

      <!-- Outer device body with gentle highlight and shadow, screen area punched out -->
      <rect x="0" y="0" width="${frameWidth}" height="${frameHeight}"
            rx="${settings.frameBorderRadius}" ry="${settings.frameBorderRadius}"
            fill="url(#bodyGradient)" filter="url(#shadow)" mask="url(#bezelMask)"/>

      <!-- Subtle outer rim highlight -->
      <rect x="1" y="1" width="${frameWidth-2}" height="${frameHeight-2}"
            rx="${Math.max(0, settings.frameBorderRadius-1)}" ry="${Math.max(0, settings.frameBorderRadius-1)}"
            fill="none" stroke="url(#rimGradient)" stroke-width="2" mask="url(#bezelMask)"/>

      <!-- Home indicator (for iPhone only) -->
      ${deviceType === 'iphone' ? `<rect x="${frameWidth/2 - settings.homeIndicator.width/2}" y="${frameHeight - settings.homeIndicator.height - 34}" width="${settings.homeIndicator.width}" height="${settings.homeIndicator.height}" rx="${settings.homeIndicator.borderRadius}" ry="${settings.homeIndicator.borderRadius}" fill="#ffffff" opacity="${settings.homeIndicator.opacity}"/>` : ''}
    </svg>
  `;

  return Buffer.from(bezelsSvg);
}

/**
 * Calculates the offset for positioning the screenshot on the frame
 */
function getScreenshotOffset(deviceType: string, screenshotWidth: number, screenshotHeight: number, isTop: boolean = true, settings: FrameSettings = defaultFrameSettings): number {
  const margin = typeof settings.edgeMargin === 'number'
    ? settings.edgeMargin
    : (isTop ? settings.screenshotOffset.top : settings.screenshotOffset.left);
  return margin;
}

/**
 * Recursively scans a directory for PNG files
 */
async function findPngFiles(dirPath: string): Promise<string[]> {
  const pngFiles: string[] = [];

  async function scanDirectory(currentPath: string): Promise<void> {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // Skip the 'output' directory to avoid processing previously framed images
          if (entry.name !== 'output') {
            await scanDirectory(fullPath);
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
          pngFiles.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read directory ${currentPath}:`, error);
    }
  }

  await scanDirectory(dirPath);
  return pngFiles;
}

/**
 * Generates an output path based on the input path, maintaining directory structure
 */
function generateOutputPath(inputPath: string): string {
  // Find the 'screenshots' directory in the path and replace it with 'framed_screenshots'
  const inputPathNormalized = path.normalize(inputPath);
  const screenshotsIndex = inputPathNormalized.indexOf('screenshots');

  if (screenshotsIndex !== -1) {
    // Extract the path from 'screenshots' onwards
    const relativePath = inputPathNormalized.substring(screenshotsIndex + 'screenshots'.length);
    // Construct new path with 'framed_screenshots' - relative to the framer.ts directory
    const outputPath = path.join(__dirname, 'framed_screenshots', relativePath);
    // Get the directory containing the screenshot
    const outputDir = path.dirname(outputPath);
    // Always save as 'framed.png'
    return path.join(outputDir, 'framed.png');
  }

  // Fallback for paths that don't contain 'screenshots'
  const inputDir = path.dirname(inputPath);
  const outputDir = path.join(__dirname, 'framed_screenshots', path.basename(inputDir));
  return path.join(outputDir, 'framed.png');
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for locale argument
  let targetLocale: string | undefined;
  const localeIndex = args.indexOf('--locale');
  if (localeIndex !== -1 && args[localeIndex + 1]) {
    targetLocale = args[localeIndex + 1];
    args.splice(localeIndex, 2); // Remove the --locale and its value from args
  }

  if (args.length === 0) {
    // No arguments provided - scan and process all screenshots (or filter by locale)
    const localeFilter = targetLocale ? ` for locale '${targetLocale}'` : '';
    console.log(`No input file specified. Scanning 00_input/screenshots/${localeFilter} for PNG files...`);

    try {
      const screenshotsDir = path.resolve(__dirname, '../00_input/screenshots');
      const pngFiles = await findPngFiles(screenshotsDir);

      if (pngFiles.length === 0) {
        console.log(`No PNG files found in screenshots directory: ${screenshotsDir}`);
        process.exit(0);
      }

      // Filter files by locale if specified
      let filteredFiles = pngFiles;
      if (targetLocale) {
        filteredFiles = pngFiles.filter(file => {
          const relativePath = path.relative(screenshotsDir, file);
          const pathParts = relativePath.split(path.sep);
          const fileLocale = pathParts[1]; // iphone/locale/slot_1/file.png
          return fileLocale === targetLocale;
        });

        if (filteredFiles.length === 0) {
          console.log(`No PNG files found for locale '${targetLocale}' in: ${screenshotsDir}`);
          process.exit(0);
        }
      }

      // Count files by locale for better reporting
      const localeCounts: { [locale: string]: number } = {};
      filteredFiles.forEach(file => {
        const relativePath = path.relative(screenshotsDir, file);
        const pathParts = relativePath.split(path.sep);
        const locale = pathParts[1] || 'unknown'; // iphone/locale/slot_1/file.png
        localeCounts[locale] = (localeCounts[locale] || 0) + 1;
      });

      console.log(`Found ${filteredFiles.length} PNG file(s) across ${Object.keys(localeCounts).length} locale(s):`);
      Object.entries(localeCounts).forEach(([locale, count]) => {
        console.log(`  - ${locale}: ${count} file(s)`);
      });
      console.log('');

      // PARALLEL PROCESSING IMPLEMENTATION
      let processed = 0;
      let failed = 0;

      // Process files in batches to avoid overwhelming the system
      for (let i = 0; i < filteredFiles.length; i += FRAMER_BATCH_SIZE) {
        const batch = filteredFiles.slice(i, i + FRAMER_BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / FRAMER_BATCH_SIZE) + 1}/${Math.ceil(filteredFiles.length / FRAMER_BATCH_SIZE)} (${batch.length} files)...`);

        const batchPromises = batch.map(async (inputPath, batchIndex) => {
          const globalIndex = i + batchIndex + 1;
          try {
            console.log(`[${globalIndex}/${filteredFiles.length}] Processing: ${path.basename(inputPath)}`);
            await frameScreenshot({
              inputPath,
              deviceType: path.basename(path.dirname(path.dirname(path.dirname(inputPath)))) === 'ipad' ? 'ipad' : 'iphone'
            });
            return { success: true, inputPath };
          } catch (error) {
            console.error(`Failed to process ${inputPath}:`, error);
            return { success: false, inputPath, error };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        batchResults.forEach(result => {
          if (result.success) {
            processed++;
          } else {
            failed++;
          }
        });
      }

      console.log(`\nBatch processing completed:`);
      console.log(`  ✅ Successfully processed: ${processed} file(s)`);
      if (failed > 0) {
        console.log(`  ❌ Failed to process: ${failed} file(s)`);
      }

    } catch (error) {
      console.error('Failed to scan screenshots directory:', error);
      process.exit(1);
    }

  } else if (args[0] === '--help' || args[0] === '-h') {
    // Show help
    console.log('App Store Screenshot Framer');
    console.log('');
    console.log('Usage:');
    console.log('  tsx 01_input_framed/framer.ts                           # Process all PNG files in 00_input/screenshots/');
    console.log('  tsx 01_input_framed/framer.ts --locale <locale>         # Process PNG files for specific locale');
    console.log('  tsx 01_input_framed/framer.ts <input-file>              # Process specific PNG file');
    console.log('  tsx 01_input_framed/framer.ts --help                    # Show this help');
    console.log('');
    console.log('The tool automatically processes screenshots for all available locales');
    console.log('found in 00_input/screenshots/iphone/[locale]/ directories.');
    console.log('');
    console.log('Settings can be customized in 01_input_framed/settings.ts:');
    console.log('  - Border radius for images and frames');
    console.log('  - Frame padding and screenshot positioning');
    console.log('  - Home indicator dimensions and styling');
    console.log('  - Shadow effects and opacity');
    console.log('');
    console.log('Examples:');
    console.log('  tsx 01_input_framed/framer.ts');
    console.log('  tsx 01_input_framed/framer.ts 00_input/screenshots/iphone/en/slot_1/screenshot.png');
    console.log('');
    console.log('Output:');
    console.log('  Framed screenshots are saved to 01_input_framed/framed_screenshots/');
    console.log('  maintaining the same directory structure as the input.');

  } else {
    // Specific file provided
    const inputPath = args[0];
    const outputPath = args[1];

    try {
      await frameScreenshot({
        inputPath,
        outputPath,
        deviceType: 'iphone'
      });
      console.log('Framing completed successfully!');
    } catch (error) {
      console.error('Failed to frame screenshot:', error);
      process.exit(1);
    }
  }
}

// Export for use as a module
export { frameScreenshot };

// Run if called directly
if (require.main === module) {
  main();
}
