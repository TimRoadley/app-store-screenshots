import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { readdir } from 'fs/promises';
import { defaultSettings, CombineSettings } from './settings';

// Sharp performance optimizations for 24-core system
sharp.concurrency(2); // Limit internal thread pool to avoid oversubscription
sharp.cache(false); // Disable cache for better memory usage with large batches

// Batch processing configuration
const COMBINER_BATCH_SIZE = 12; // 12 parallel operations for memory-intensive compositing

interface CombineOptions {
  backgroundPath?: string;
  framedScreenshotsPath?: string;
  outputPath?: string;
  spacing?: number;
  deviceType?: 'iphone' | 'ipad';
  locale?: string;
  titles?: string[];
  titleFontSize?: number;
  titleColor?: string;
  titleShadowColor?: string;
  titleShadowOffset?: number;
  titleSpacing?: number;
  centerInQuarters?: boolean;
  iPhoneScaleFactor?: number;
  iPadScaleFactor?: number;
}

/**
 * Gets all available locales from the translations directory
 */
async function getAvailableLocales(): Promise<string[]> {
  const translationsDir = path.resolve(__dirname, '../00_input/translations');

  try {
    const entries = await readdir(translationsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name.replace('.json', ''))
      .sort(); // Sort alphabetically for consistent processing order
  } catch (error) {
    console.warn(`Could not read translations directory: ${translationsDir}`);
    console.warn('Falling back to default locale: en');
    return ['en'];
  }
}

/**
 * Loads titles from the translations file for the specified locale
 */
async function loadTitles(locale: string): Promise<string[]> {
  const translationsPath = path.resolve(__dirname, '../00_input/translations', `${locale}.json`);

  try {
    const translationsData = await fs.readFile(translationsPath, 'utf-8');
    const translations = JSON.parse(translationsData);

    // Extract titles in slot order
    const titles: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const slotKey = `slot_${i}`;
      if (translations[slotKey]) {
        titles.push(translations[slotKey]);
      } else {
        titles.push(`Screenshot ${i}`);
      }
    }

    return titles;
  } catch (error) {
    console.warn(`Warning: Could not load translations from ${translationsPath}, using defaults:`, error);
    // Return default titles if translations file doesn't exist
    return [
      'Screenshot 1',
      'Screenshot 2',
      'Screenshot 3',
      'Screenshot 4',
    ];
  }
}

/**
 * Generates an SVG buffer for a title text with shadow support.
 * Allows constraining to a maximum number of lines (1 or 2).
 * Returns both the buffer and the computed SVG height for precise placement.
 */
function generateTitleSvg(
  text: string,
  fontSize: number,
  color: string,
  shadowColor: string,
  shadowOffset: number,
  width: number,
  maxLines: 1 | 2 = 2
): { buffer: Buffer; svgHeight: number } {
  const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Support manual line breaks via "\n" in translations
  const manualParts = text.split(/\r?\n|\\n/).filter(Boolean);

  // Split text into lines, constrained by maxLines
  const maxCharsPerLine = Math.floor(width / (fontSize * 0.6));
  let line1 = '';
  let line2 = '';

  if (manualParts.length > 1) {
    line1 = escapeXml(manualParts[0].trim());
    line2 = escapeXml(manualParts.slice(1).join(' ').trim());
  } else {
    const escapedText = escapeXml(text);
    line1 = escapedText;
    if (escapedText.length > maxCharsPerLine) {
      const words = escapedText.split(' ');
      let currentLine = '';
      let breakIndex = 0;

      for (let i = 0; i < words.length; i++) {
        const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
        if (testLine.length > maxCharsPerLine && currentLine) {
          breakIndex = i;
          break;
        }
        currentLine = testLine;
        breakIndex = i + 1;
      }

      if (breakIndex > 0 && breakIndex < words.length) {
        line1 = words.slice(0, breakIndex).join(' ');
        line2 = words.slice(breakIndex).join(' ');
      }
    }
  }

  // If constrained to a single line, drop any second line
  if (maxLines === 1) {
    line2 = '';
  }

  // Calculate height for the number of rendered lines, include symmetric padding for ascenders/descenders and shadow
  const lineHeight = fontSize * 1.2; // Line height for readability
  const renderedLines = line2 ? 2 : 1;
  const contentHeight = lineHeight * renderedLines;
  const pad = Math.ceil(fontSize * 0.2) + Math.abs(shadowOffset);
  const svgHeight = Math.ceil(contentHeight + pad * 2);
  const isTwoLines = renderedLines === 2;
  const textY1 = Math.ceil(pad + (isTwoLines ? lineHeight / 2 : contentHeight / 2));
  const textY2 = textY1 + lineHeight;

  // Create shadow text elements (rendered first, so main text appears on top)
  let shadowElements = `<text x="${width / 2 + shadowOffset}" y="${textY1 + shadowOffset}" class="title-shadow">${line1}</text>`;
  if (line2) {
    shadowElements += `<text x="${width / 2 + shadowOffset}" y="${textY2 + shadowOffset}" class="title-shadow">${line2}</text>`;
  }

  // Create main text elements
  let textElements = `<text x="${width / 2}" y="${textY1}" class="title-text">${line1}</text>`;
  if (line2) {
    textElements += `<text x="${width / 2}" y="${textY2}" class="title-text">${line2}</text>`;
  }

  const svg = `
    <svg width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}" preserveAspectRatio="xMidYMin slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600&amp;display=swap');
          .title-shadow {
            font-family: 'Montserrat', sans-serif;
            font-weight: 600;
            font-size: ${fontSize}px;
            fill: ${shadowColor};
            text-anchor: middle;
            dominant-baseline: middle;
          }
          .title-text {
            font-family: 'Montserrat', sans-serif;
            font-weight: 600;
            font-size: ${fontSize}px;
            fill: ${color};
            text-anchor: middle;
            dominant-baseline: middle;
          }
        </style>
      </defs>
      ${shadowElements}
      ${textElements}
    </svg>
  `;
  return { buffer: Buffer.from(svg), svgHeight };
}

/**
 * Combines 4 framed screenshots side by side over a background image
 */
async function combineScreenshots(options: CombineOptions = {}): Promise<string> {
  const {
    backgroundPath = defaultSettings.backgroundPath,
    framedScreenshotsPath = defaultSettings.framedScreenshotsPath,
    spacing = defaultSettings.spacing,
    deviceType = defaultSettings.deviceType,
    locale = defaultSettings.locale,
    titles,
    titleFontSize = defaultSettings.titleFontSize,
    titleColor = defaultSettings.titleColor,
    titleShadowColor = defaultSettings.titleShadowColor,
    titleShadowOffset = defaultSettings.titleShadowOffset,
    titleSpacing = defaultSettings.titleSpacing,
    centerInQuarters = defaultSettings.centerInQuarters,
    iPhoneScaleFactor = defaultSettings.iPhoneScaleFactor,
    iPadScaleFactor = defaultSettings.iPadScaleFactor
  } = options;

  // Determine which scale factor to use based on device type
  const scaleFactor = deviceType === 'ipad' ? iPadScaleFactor : iPhoneScaleFactor;

  // Load titles from translations if not provided
  const finalTitles = titles || await loadTitles(locale);

  // Generate output path if not provided
  const outputPath = options.outputPath || generateOutputPath(framedScreenshotsPath, deviceType, locale);

  try {
    console.log('Starting screenshot combination process...');

    // Load background image with performance optimizations
    const backgroundImage = sharp(backgroundPath, {
      failOnError: false,
      limitInputPixels: false
    });
    const backgroundMetadata = await backgroundImage.metadata();
    console.log(`Background image: ${backgroundMetadata.width}x${backgroundMetadata.height}`);

    // Find all framed screenshots
    const framedScreenshotPaths = await findFramedScreenshots(framedScreenshotsPath, deviceType, locale);

    if (framedScreenshotPaths.length === 0) {
      const searchPath = path.join(framedScreenshotsPath, deviceType, locale);
      throw new Error(`No framed screenshots found in: ${searchPath}`);
    }

    console.log(`Found ${framedScreenshotPaths.length} framed screenshots:`);
    framedScreenshotPaths.forEach((file, index) => {
      console.log(`  ${index + 1}. ${path.basename(path.dirname(file))}/${path.basename(file)}`);
    });

    // Load all framed images, apply scaling, and get their dimensions with performance optimizations
    const framedImages = await Promise.all(
      framedScreenshotPaths.map(async (filePath) => {
        const image = sharp(filePath, {
          failOnError: false,
          limitInputPixels: false
        });
        const metadata = await image.metadata();

        // Apply scaling if scaleFactor is not 1.0
        let scaledImage = image;
        let scaledWidth = metadata.width!;
        let scaledHeight = metadata.height!;

        if (scaleFactor !== 1.0) {
          scaledWidth = Math.round(metadata.width! * scaleFactor);
          scaledHeight = Math.round(metadata.height! * scaleFactor);
          scaledImage = image.resize(scaledWidth, scaledHeight, {
            fit: 'fill',
            withoutEnlargement: false
          });
        }

        return {
          image: scaledImage,
          originalWidth: metadata.width!,
          originalHeight: metadata.height!,
          width: scaledWidth,
          height: scaledHeight,
          buffer: await scaledImage.png().toBuffer()
        };
      })
    );

    // Calculate dimensions for the combined image
    const { canvasWidth, canvasHeight, imageWidth, imageHeight, quarterWidth } = calculateCanvasDimensions(
      framedImages,
      spacing,
      backgroundMetadata.width!,
      backgroundMetadata.height!,
      titleFontSize,
      titleSpacing,
      centerInQuarters,
      deviceType === 'ipad'
    );

    console.log(`Canvas dimensions: ${canvasWidth}x${canvasHeight}`);
    console.log(`Individual image dimensions: ${imageWidth}x${imageHeight} (scaled by ${scaleFactor}, with spacing: ${spacing}px)`);
    console.log(`Titles: ${finalTitles.join(', ')} (font size: ${titleFontSize}px, color: ${titleColor}, shadow: ${titleShadowColor} offset: ${titleShadowOffset}px)`);

    // Prepare background (resize if needed)
    let resizedBackground = backgroundImage;
    if (canvasWidth > backgroundMetadata.width! || canvasHeight > backgroundMetadata.height!) {
      console.log('Resizing background to fit canvas...');
      resizedBackground = backgroundImage.resize(canvasWidth, canvasHeight, {
        fit: 'fill',
        position: 'center'
      });
    }

    // Create composite operations for titles and images
    const compositeOperations: sharp.OverlayOptions[] = [];

    // Calculate title area (matches calculateCanvasDimensions) and SVG height for vertical centering
    const singleLineTitles = deviceType === 'ipad';
    const lineHeight = titleFontSize * 1.2;
    const pad = Math.ceil(titleFontSize * 0.2) + Math.abs(titleShadowOffset);
    const linesForSvg = singleLineTitles ? 1 : 2;
    const titleHeight = (titleFontSize * (1.2 * linesForSvg)) + titleSpacing;

    // Add title operations
    for (let index = 0; index < framedImages.length; index++) {
      const titleText = finalTitles[index] || `Screenshot ${index + 1}`;
      const { buffer: titleSvgBuffer, svgHeight: currentTitleSvgHeight } = generateTitleSvg(
        titleText,
        titleFontSize,
        titleColor,
        titleShadowColor,
        titleShadowOffset,
        imageWidth,
        singleLineTitles ? 1 : 2
      );

      const leftPosition = centerInQuarters
        ? Math.round(((index * quarterWidth) + (quarterWidth / 2)) - (imageWidth / 2))
        : index * (imageWidth + spacing) + spacing;

      compositeOperations.push({
        input: titleSvgBuffer,
        top: spacing + Math.max(0, Math.round((titleHeight - currentTitleSvgHeight) / 2)),
        left: leftPosition
      });
    }

    // Add image operations (shifted down to make room for titles)
    for (let index = 0; index < framedImages.length; index++) {
      const framedImage = framedImages[index];

      let leftPosition: number;
      if (centerInQuarters) {
        // Center the scaled image within its quarter
        const quarterCenter = (index * quarterWidth) + (quarterWidth / 2);
        leftPosition = Math.round(quarterCenter - (framedImage.width / 2));
      } else {
        // Use spacing-based positioning, center the scaled image in its allocated space
        // Use original dimensions for spacing calculations, not scaled ones
        const originalWidth = framedImage.originalWidth;
        const spaceStart = index * (originalWidth + spacing) + spacing;
        leftPosition = Math.round(spaceStart + (originalWidth - framedImage.width) / 2);
      }

      compositeOperations.push({
        input: framedImage.buffer,
        top: spacing + titleHeight,
        left: leftPosition
      });
    }

    // Composite everything
    const combinedImage = await resizedBackground
      .composite(compositeOperations)
      .png()
      .toBuffer();

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Save the combined image
    await sharp(combinedImage).toFile(outputPath);

    console.log(`Combined screenshot saved to: ${outputPath}`);
    return outputPath;

  } catch (error) {
    console.error('Error combining screenshots:', error);
    throw error;
  }
}

/**
 * Finds all framed screenshots for the specified device type and locale
 */
async function findFramedScreenshots(basePath: string, deviceType: string, locale: string): Promise<string[]> {
  const devicePath = path.join(basePath, deviceType, locale);

  try {
    const slotDirs = await fs.readdir(devicePath);
    const screenshotPaths: string[] = [];

    // Look for slot directories
    for (const slotDir of slotDirs) {
      const slotPath = path.join(devicePath, slotDir);
      const stat = await fs.stat(slotPath);

      if (stat.isDirectory() && slotDir.startsWith('slot_')) {
        const framedPath = path.join(slotPath, 'framed.png');

        try {
          await fs.access(framedPath);
          screenshotPaths.push(framedPath);
        } catch {
          // framed.png doesn't exist in this slot, skip
        }
      }
    }

    // Sort by slot number
    return screenshotPaths.sort((a, b) => {
      const slotA = parseInt(path.basename(path.dirname(a)).replace('slot_', ''));
      const slotB = parseInt(path.basename(path.dirname(b)).replace('slot_', ''));
      return slotA - slotB;
    });

  } catch (error) {
    console.warn(`Warning: Could not read directory ${devicePath}:`, error);
    return [];
  }
}

/**
 * Calculates the canvas dimensions needed for the combined image
 */
function calculateCanvasDimensions(
  framedImages: Array<{ width: number; height: number; originalWidth?: number; originalHeight?: number }>,
  spacing: number,
  bgWidth: number,
  bgHeight: number,
  titleFontSize: number,
  titleSpacing: number,
  centerInQuarters: boolean,
  singleLineTitles: boolean
): { canvasWidth: number; canvasHeight: number; imageWidth: number; imageHeight: number; quarterWidth: number } {
  // Use the first image's original dimensions as reference for canvas calculations (assuming all are the same)
  // This ensures consistent spacing and sizing regardless of scaling
  const imageWidth = framedImages[0].originalWidth || framedImages[0].width;
  const imageHeight = framedImages[0].originalHeight || framedImages[0].height;

  // Calculate title height based on number of lines (iPad uses single-line titles)
  const lines = singleLineTitles ? 1 : 2;
  const pad = Math.ceil(titleFontSize * 0.2) + 1; // +1 minimal shadow offset if any
  const titleHeight = Math.ceil((titleFontSize * 1.2 * lines) + pad * 2) + titleSpacing;

  // Calculate required canvas size (including title space)
  const totalWidth = (imageWidth * framedImages.length) + (spacing * (framedImages.length + 1));
  const totalHeight = imageHeight + titleHeight + (spacing * 2);

  // Use the larger of background or calculated size
  const canvasWidth = Math.max(bgWidth, totalWidth);
  const canvasHeight = Math.max(bgHeight, totalHeight);

  // Quarters are equal divisions of the canvas width. Even if not centering,
  // returning this helps callers compute precise positions when needed.
  const quarterWidth = Math.floor(canvasWidth / framedImages.length);

  return { canvasWidth, canvasHeight, imageWidth, imageHeight, quarterWidth };
}

/**
 * Generates an output path for the combined image
 */
function generateOutputPath(framedScreenshotsPath: string, deviceType: string, locale: string): string {
  // Create output path like: 02_input_combined/combined_screenshots/iphone/en/combined.png
  // Resolve from the combiner directory
  return path.resolve(__dirname, 'combined_screenshots', deviceType, locale, 'combined.png');
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for device argument
  let targetDevice: 'iphone' | 'ipad' | undefined;
  const deviceIndex = args.indexOf('--device');
  if (deviceIndex !== -1 && args[deviceIndex + 1]) {
    const deviceValue = args[deviceIndex + 1];
    if (deviceValue === 'iphone' || deviceValue === 'ipad') {
      targetDevice = deviceValue;
    } else {
      console.error(`❌ Invalid device type: ${deviceValue}. Must be 'iphone' or 'ipad'.`);
      process.exit(1);
    }
    args.splice(deviceIndex, 2); // Remove the --device and its value from args
  }

  if (args.length === 0) {
    // No arguments - process all available locales
    console.log('Combining screenshots for all available locales...');
    console.log('Background: 00_input/background/bg.png');
    console.log('Framed screenshots: 01_input_framed/framed_screenshots/');
    console.log(`Spacing: ${defaultSettings.spacing}px`);

    try {
      const locales = await getAvailableLocales();
      console.log(`Found ${locales.length} locale(s): ${locales.join(', ')}`);
      console.log('');

      // PARALLEL PROCESSING IMPLEMENTATION
      let processed = 0;
      let failed = 0;

      // Process locales in batches to avoid overwhelming the system
      for (let i = 0; i < locales.length; i += COMBINER_BATCH_SIZE) {
        const batch = locales.slice(i, i + COMBINER_BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / COMBINER_BATCH_SIZE) + 1}/${Math.ceil(locales.length / COMBINER_BATCH_SIZE)} (${batch.length} locales)...`);

        const batchPromises = batch.map(async (locale, batchIndex) => {
          const globalIndex = i + batchIndex + 1;
          try {
            console.log(`[${globalIndex}/${locales.length}] Processing locale: ${locale}`);
            const titles = await loadTitles(locale);
            const scaleFactor = targetDevice === 'ipad' ? defaultSettings.iPadScaleFactor : defaultSettings.iPhoneScaleFactor;
            console.log(`Titles: ${titles.join(', ')} (${defaultSettings.titleFontSize}px, ${defaultSettings.titleColor}, shadow: ${defaultSettings.titleShadowColor} offset: ${defaultSettings.titleShadowOffset}px, scale: ${scaleFactor})`);
            console.log('');

            await combineScreenshots({
              locale,
              deviceType: targetDevice,
              iPhoneScaleFactor: defaultSettings.iPhoneScaleFactor,
              iPadScaleFactor: defaultSettings.iPadScaleFactor
            });
            return { success: true, locale };
          } catch (error) {
            console.error(`❌ Failed to process locale ${locale}:`, error);
            return { success: false, locale, error };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        batchResults.forEach(result => {
          if (result.success) {
            processed++;
            console.log(`✅ Successfully processed locale: ${result.locale}\n`);
          } else {
            failed++;
            console.log('');
          }
        });
      }

      console.log('Multi-locale combination completed:');
      console.log(`  ✅ Successfully processed: ${processed} locale(s)`);
      if (failed > 0) {
        console.log(`  ❌ Failed to process: ${failed} locale(s)`);
        process.exit(1);
      }
    } catch (error) {
      console.error('Failed to process locales:', error);
      process.exit(1);
    }

  } else if (args[0] === '--help' || args[0] === '-h') {
    // Show help
    console.log('App Store Screenshot Combiner');
    console.log('');
    console.log('Combines 4 framed screenshots side by side over a background image.');
    console.log('');
    console.log('Usage:');
    console.log('  tsx 02_input_combined/combiner.ts                                      # Process all available locales (iPhone)');
    console.log('  tsx 02_input_combined/combiner.ts --locale <locale>                    # Process specific locale (iPhone)');
    console.log('  tsx 02_input_combined/combiner.ts --device <iphone|ipad>               # Process all locales for specific device');
    console.log('  tsx 02_input_combined/combiner.ts --background <path>                  # Specify background image');
    console.log('  tsx 02_input_combined/combiner.ts --spacing <pixels>                   # Set spacing between images');
    console.log('  tsx 02_input_combined/combiner.ts --titles <title1,title2,title3,title4> # Override default titles from translations');
    console.log('  tsx 02_input_combined/combiner.ts --title-font-size <size>             # Set title font size');
    console.log('  tsx 02_input_combined/combiner.ts --title-color <color>                # Set title color (hex)');
    console.log('  tsx 02_input_combined/combiner.ts --title-shadow-color <color>         # Set title shadow color (hex)');
    console.log('  tsx 02_input_combined/combiner.ts --title-shadow-offset <pixels>       # Set title shadow offset');
    console.log('  tsx 02_input_combined/combiner.ts --title-spacing <pixels>             # Set spacing below titles');
    console.log('  tsx 02_input_combined/combiner.ts --iphone-scale-factor <factor>      # Scale iPhone framed screenshots (e.g., 0.9)');
    console.log('  tsx 02_input_combined/combiner.ts --ipad-scale-factor <factor>        # Scale iPad framed screenshots (e.g., 0.9)');
    console.log('  tsx 02_input_combined/combiner.ts --help                               # Show this help');
    console.log('');
    console.log('Examples:');
    console.log('  tsx 02_input_combined/combiner.ts');
    console.log('  tsx 02_input_combined/combiner.ts --locale en');
    console.log('  tsx 02_input_combined/combiner.ts --background 00_input/background/bg.png --spacing 60');
    console.log('  tsx 02_input_combined/combiner.ts --titles "Login,Home,Profile,Settings" --title-font-size 28 --title-color "#ffffff" --title-shadow-color "#000000" --title-shadow-offset 2');
    console.log('  tsx 02_input_combined/combiner.ts --iphone-scale-factor 0.8 --ipad-scale-factor 0.9 --locale en');
    console.log('');
    console.log('Default paths:');
    console.log('  Background: 00_input/background/bg.png');
    console.log('  Framed screenshots: 01_input_framed/framed_screenshots/');
    console.log('  Titles: 00_input/translations/[locale].json');
    console.log('');
    console.log('The tool automatically detects all locales from 00_input/translations/');
    console.log('and processes each locale\'s framed screenshots.');
    console.log('');
    console.log('Output:');
    console.log('  combined_screenshots/[iphone|ipad]/[locale]/combined.png');

  } else {
    // Parse arguments
    let backgroundPath = defaultSettings.backgroundPath;
    let spacing = defaultSettings.spacing;
    let titles: string[] | undefined;
    let titleFontSize = defaultSettings.titleFontSize;
    let titleColor = defaultSettings.titleColor;
    let titleShadowColor = defaultSettings.titleShadowColor;
    let titleShadowOffset = defaultSettings.titleShadowOffset;
    let titleSpacing = defaultSettings.titleSpacing;
    let iPhoneScaleFactor = defaultSettings.iPhoneScaleFactor;
    let iPadScaleFactor = defaultSettings.iPadScaleFactor;
    let locale = 'en'; // Default locale for single processing

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--background' && args[i + 1]) {
        backgroundPath = args[i + 1];
        i++;
      } else if (args[i] === '--spacing' && args[i + 1]) {
        spacing = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--locale' && args[i + 1]) {
        locale = args[i + 1];
        i++;
      } else if (args[i] === '--titles' && args[i + 1]) {
        titles = args[i + 1].split(',');
        i++;
      } else if (args[i] === '--title-font-size' && args[i + 1]) {
        titleFontSize = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--title-color' && args[i + 1]) {
        titleColor = args[i + 1];
        i++;
      } else if (args[i] === '--title-shadow-color' && args[i + 1]) {
        titleShadowColor = args[i + 1];
        i++;
      } else if (args[i] === '--title-shadow-offset' && args[i + 1]) {
        titleShadowOffset = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--title-spacing' && args[i + 1]) {
        titleSpacing = parseInt(args[i + 1]);
        i++;
      } else if (args[i] === '--iphone-scale-factor' && args[i + 1]) {
        iPhoneScaleFactor = parseFloat(args[i + 1]);
        i++;
      } else if (args[i] === '--ipad-scale-factor' && args[i + 1]) {
        iPadScaleFactor = parseFloat(args[i + 1]);
        i++;
      }
    }

    // Load titles from translations if not explicitly provided
    if (!titles) {
      try {
        titles = await loadTitles(locale);
      } catch (error) {
        console.warn(`Could not load titles for locale ${locale}, using defaults:`, error);
        titles = [
          'Save & Create Recipes',
          'Plan Meals in Seconds',
          'Smart Grocery Lists',
          'Step-by-Step Cooking'
        ];
      }
    }

    console.log(`Processing single locale: ${locale}`);
    if (targetDevice) {
      console.log(`Target device: ${targetDevice}`);
    }
    console.log(`Using background: ${backgroundPath}`);
    console.log(`Using spacing: ${spacing}px`);
    console.log(`Using scale factors - iPhone: ${iPhoneScaleFactor}, iPad: ${iPadScaleFactor}`);
    console.log(`Using titles: ${titles.join(', ')}`);
    console.log(`Title font size: ${titleFontSize}px, color: ${titleColor}, shadow: ${titleShadowColor} offset: ${titleShadowOffset}px`);
    console.log('');

    try {
      await combineScreenshots({
        backgroundPath,
        spacing,
        locale,
        titles,
        titleFontSize,
        titleColor,
        titleShadowColor,
        titleShadowOffset,
        titleSpacing,
        iPhoneScaleFactor,
        iPadScaleFactor,
        deviceType: targetDevice || defaultSettings.deviceType
      });
      console.log('Combination completed successfully!');
    } catch (error) {
      console.error('Failed to combine screenshots:', error);
      process.exit(1);
    }
  }
}

// Export for use as a module
export { combineScreenshots };

// Run if called directly
if (require.main === module) {
  main();
}
