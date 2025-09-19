import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { readdir } from 'fs/promises';

// Sharp performance optimizations for 24-core system
sharp.concurrency(2); // Limit internal thread pool to avoid oversubscription
sharp.cache(false); // Disable cache for better memory usage with large batches

// Batch processing configuration
const SPLITTER_BATCH_SIZE = 16; // 16 parallel operations for resize/split operations

interface DeviceConfig {
  name: string;
  width: number;
  height: number;
  outputPath: string;
}

interface SplitterOptions {
  inputPath?: string;
  outputBasePath?: string;
  deviceConfigs?: DeviceConfig[];
  locale?: string;
  deviceType?: 'iphone' | 'ipad';
}

/**
 * Configuration for different device screenshot resolutions
 */
const DEFAULT_DEVICE_CONFIGS: DeviceConfig[] = [
  // {
  //   name: 'iphone 6.7 inch',
  //   width: 1290,
  //   height: 2796,
  //   outputPath: 'iphone 6.7 inch (1290x2796)'
  // },
  {
    name: 'iphone 6.5 inch',
    width: 1242,
    height: 2688,
    outputPath: 'iphone 6.5 inch (1242x2688)'
  },
  {
    name: 'iphone 6.9 inch',
    width: 1320,
    height: 2868,
    outputPath: 'iphone 6.9 inch (1320x2868)'
  },
  {
    name: 'ipad 13 inch',
    width: 2752,
    height: 2064,
    outputPath: 'ipad 13 inch (2752x2064)'
  }
];

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
 * Splits combined screenshots into individual device-sized images
 */
async function splitScreenshots(options: SplitterOptions = {}): Promise<void> {
  const {
    inputPath = path.resolve(__dirname, '../02_input_combined/combined_screenshots'),
    outputBasePath = path.resolve(__dirname, '../output'),
    deviceConfigs = DEFAULT_DEVICE_CONFIGS,
    locale = 'en',
    deviceType = 'iphone'
  } = options;

  // Filter device configs based on device type if specified
  const filteredConfigs = deviceType === 'iphone'
    ? deviceConfigs.filter(config => config.name.toLowerCase().includes('iphone'))
    : deviceType === 'ipad'
    ? deviceConfigs.filter(config => config.name.toLowerCase().includes('ipad'))
    : deviceConfigs;

  try {
    console.log('Starting screenshot splitting process...');
    console.log(`Input path: ${inputPath}`);
    console.log(`Output base path: ${outputBasePath}`);

    // Find combined screenshot
    const combinedImagePath = path.join(inputPath, deviceType, locale, 'combined.png');

    // Check if combined image exists
    try {
      await fs.access(combinedImagePath);
    } catch {
      throw new Error(`Combined image not found: ${combinedImagePath}`);
    }

    console.log(`Found combined image: ${combinedImagePath}`);

    // Load the combined image with performance optimizations
    const combinedImage = sharp(combinedImagePath, {
      failOnError: false,
      limitInputPixels: false
    });
    const metadata = await combinedImage.metadata();

    console.log(`Combined image dimensions: ${metadata.width}x${metadata.height}`);

    // Validate that we have a valid image
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid combined image: missing width or height metadata');
    }

    // Validate minimum dimensions
    if (metadata.width < 1000 || metadata.height < 1000) {
      throw new Error(`Combined image too small: ${metadata.width}x${metadata.height}. Expected at least 1000x1000.`);
    }

    // Process each device configuration
    for (const deviceConfig of filteredConfigs) {
      console.log(`\nProcessing ${deviceConfig.name}...`);

      await processDeviceConfig(
        combinedImage,
        metadata,
        deviceConfig,
        outputBasePath,
        locale
      );
    }

    console.log('\n✅ Screenshot splitting completed successfully!');

  } catch (error) {
    console.error('Error splitting screenshots:', error);
    throw error;
  }
}

/**
 * Process a single device configuration
 */
async function processDeviceConfig(
  combinedImage: sharp.Sharp,
  metadata: sharp.Metadata,
  deviceConfig: DeviceConfig,
  outputBasePath: string,
  locale: string
): Promise<void> {
  const { width: targetWidth, height: targetHeight, outputPath: deviceOutputPath } = deviceConfig;

  // Calculate resize dimensions
  // We need 4x width to split into quarters
  const resizedWidth = targetWidth * 4; // 4x the target width

  // Calculate height maintaining aspect ratio
  const aspectRatio = metadata.height! / metadata.width!;
  const resizedHeight = Math.round(resizedWidth * aspectRatio);

  console.log(`  Target dimensions: ${targetWidth}x${targetHeight}`);
  console.log(`  Resize to: ${resizedWidth}x${resizedHeight} (maintain aspect ratio)`);

  // Resize the image
  let finalImage = combinedImage.resize(resizedWidth, resizedHeight, {
    fit: 'fill',
    position: 'center'
  });

  // Track final dimensions
  let finalWidth = resizedWidth;
  let finalHeight = resizedHeight;

  // If height is greater than target, crop from bottom
  if (resizedHeight > targetHeight) {
    console.log(`  Cropping height from ${resizedHeight} to ${targetHeight}`);
    finalImage = finalImage.extract({
      left: 0,
      top: 0,
      width: resizedWidth,
      height: targetHeight
    });
    finalHeight = targetHeight;
  }

  console.log(`  Final image dimensions: ${finalWidth}x${finalHeight}`);

  // Create output directory
  const outputDir = path.join(outputBasePath, deviceOutputPath, locale);
  await fs.mkdir(outputDir, { recursive: true });

  // Split into 4 equal parts
  const quarterWidth = targetWidth;

  for (let i = 0; i < 4; i++) {
    const slotNumber = i + 1;
    const outputPath = path.join(outputDir, `slot_${slotNumber}.png`);

    console.log(`  Creating slot_${slotNumber}.png...`);

    // Extract the quarter
    const left = i * quarterWidth;
    const extractedImage = await finalImage
      .extract({
        left: left,
        top: 0,
        width: quarterWidth,
        height: finalHeight
      })
      .png()
      .toBuffer();

    // Save the individual screenshot
    await sharp(extractedImage).toFile(outputPath);
    console.log(`    ✅ Saved to: ${outputPath}`);
  }
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for locale and device arguments
  let targetLocale: string | undefined;
  let targetDevice: 'iphone' | 'ipad' | undefined;

  const localeIndex = args.indexOf('--locale');
  if (localeIndex !== -1 && args[localeIndex + 1]) {
    targetLocale = args[localeIndex + 1];
    args.splice(localeIndex, 2); // Remove the --locale and its value from args
  }

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
    // No arguments - process all available locales or specific locale
    const localeText = targetLocale ? `locale '${targetLocale}'` : 'all available locales';
    console.log(`Splitting screenshots for ${localeText}...`);

    try {
      const allLocales = await getAvailableLocales();
      const locales = targetLocale ? [targetLocale] : allLocales;

      // Validate target locale exists
      if (targetLocale && !allLocales.includes(targetLocale)) {
        console.error(`❌ Locale '${targetLocale}' not found. Available locales: ${allLocales.join(', ')}`);
        process.exit(1);
      }

      console.log(`Found ${locales.length} locale(s): ${locales.join(', ')}`);
      console.log('');

      // PARALLEL PROCESSING IMPLEMENTATION
      let processed = 0;
      let failed = 0;

      // Process locales in batches to avoid overwhelming the system
      for (let i = 0; i < locales.length; i += SPLITTER_BATCH_SIZE) {
        const batch = locales.slice(i, i + SPLITTER_BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / SPLITTER_BATCH_SIZE) + 1}/${Math.ceil(locales.length / SPLITTER_BATCH_SIZE)} (${batch.length} locales)...`);

        const batchPromises = batch.map(async (locale, batchIndex) => {
          const globalIndex = i + batchIndex + 1;
          try {
            console.log(`[${globalIndex}/${locales.length}] Processing locale: ${locale}`);
            const deviceTypeForLog = targetDevice || 'iphone';
            console.log(`Input: 02_input_combined/combined_screenshots/${deviceTypeForLog}/${locale}/combined.png`);
            console.log(`Output: output/[device]/${locale}/slot_[1-4].png`);
            console.log('');

            await splitScreenshots({ locale, deviceType: targetDevice || 'iphone' });
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

      console.log('Multi-locale splitting completed:');
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
    console.log('App Store Screenshot Splitter');
    console.log('');
    console.log('Splits combined screenshots into individual device-sized images.');
    console.log('');
    console.log('Usage:');
    console.log('  tsx 03_splitter/splitter.ts                           # Process all available locales (iPhone)');
    console.log('  tsx 03_splitter/splitter.ts --locale <locale>         # Process specific locale (iPhone)');
    console.log('  tsx 03_splitter/splitter.ts --device <iphone|ipad>    # Process all locales for specific device');
    console.log('  tsx 03_splitter/splitter.ts --device ipad --locale en # Process specific locale and device');
    console.log('  tsx 03_splitter/splitter.ts --help                    # Show this help');
    console.log('');
    console.log('The tool automatically detects all locales from 00_input/translations/');
    console.log('and processes each locale\'s combined screenshot.');
    console.log('');
    console.log('Examples:');
    console.log('  tsx 03_splitter/splitter.ts');
    console.log('');
    console.log('Input:');
    console.log('  02_input_combined/combined_screenshots/[iphone|ipad]/[locale]/combined.png');
    console.log('');
    console.log('Output:');
    console.log('  output/iphone 6.9 inch (1320x2868)/[locale]/slot_[1-4].png');
    console.log('  output/ipad 13" (2752x2064)/[locale]/slot_[1-4].png');

  } else {
    console.log('No additional arguments supported. Use --help for usage information.');
    process.exit(1);
  }
}

// Export for use as a module
export { splitScreenshots };

// Run if called directly
if (require.main === module) {
  main();
}
