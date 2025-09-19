import { promises as fs } from 'fs';
import path from 'path';

/**
 * Recursively deletes a directory and all its contents
 */
async function deleteDirectory(dirPath: string): Promise<void> {
  try {
    // Check if directory exists
    await fs.access(dirPath);

    // Remove directory and all contents
    await fs.rm(dirPath, { recursive: true, force: true });
    console.log(`✅ Deleted: ${dirPath}`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log(`ℹ️  Directory not found (already clean): ${dirPath}`);
    } else {
      console.error(`❌ Error deleting ${dirPath}:`, error.message);
      throw error;
    }
  }
}

/**
 * Cleans up generated screenshot directories
 */
async function cleanup(): Promise<void> {
  console.log('🧹 Starting cleanup of generated screenshots...\n');

  const directoriesToClean = [
    path.join(__dirname, '../01_input_framed/framed_screenshots'),
    path.join(__dirname, '../02_input_combined/combined_screenshots'),
    path.join(__dirname, '../output')
  ];

  let cleaned = 0;
  let errors = 0;

  for (const dir of directoriesToClean) {
    try {
      // Check if output directory exists and show what locales it contains
      if (path.basename(dir) === 'output') {
        try {
          const { readdir } = require('fs/promises');
          const entries = await readdir(dir, { withFileTypes: true });
          const deviceDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
          if (deviceDirs.length > 0) {
            console.log(`📁 Found output directory with device configurations: ${deviceDirs.join(', ')}`);
            // Check for locales in the first device directory
            const firstDeviceDir = path.join(dir, deviceDirs[0]);
            const localeEntries = await readdir(firstDeviceDir, { withFileTypes: true });
            const locales = localeEntries.filter(entry => entry.isDirectory()).map(entry => entry.name);
            if (locales.length > 0) {
              console.log(`🌍 Will clean up screenshots for locales: ${locales.join(', ')}`);
            }
          }
        } catch (error) {
          // Directory might not exist or be readable, continue with cleanup
        }
      }

      await deleteDirectory(dir);
      cleaned++;
    } catch (error) {
      errors++;
    }
  }

  console.log(`\n📊 Cleanup completed:`);
  console.log(`  ✅ Successfully cleaned: ${cleaned} directory(ies)`);
  if (errors > 0) {
    console.log(`  ❌ Errors encountered: ${errors}`);
    process.exit(1);
  } else {
    console.log('  ✨ All directories cleaned successfully!');
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    await cleanup();
  } catch (error) {
    console.error('💥 Cleanup failed:', error);
    process.exit(1);
  }
}

// Export for use as a module
export { cleanup };

// Run if called directly
if (require.main === module) {
  main();
}
