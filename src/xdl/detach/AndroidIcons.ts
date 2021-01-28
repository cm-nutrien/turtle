import fs from 'fs-extra';
import { sync as globSync } from 'glob';
import path from 'path';
import logger from 'turtle/logger';

import { getImageDimensionsAsync, resizeImageAsync } from '../ImageUtils';
import {
  regexFileAsync,
  saveImageToPathAsync,
  saveUrlToPathAsync,
  spawnAsyncThrowError,
} from './ExponentTools';
import {
  AnyStandaloneContext,
  IStandaloneContextDataUser,
} from './StandaloneContext';

const iconScales = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
};

async function regexFileInResSubfoldersAsync(
  oldText: string,
  newText: string,
  resDirPath: string,
  folderPrefix: string,
  folderSuffix: string,
  fileName: string,
) {
  return Promise.all(
    Object.keys(iconScales).map(async (key) => {
      return regexFileAsync(
        oldText,
        newText,
        path.join(resDirPath, `${folderPrefix}${key}${folderSuffix}`, fileName),
      );
    }),
  );
}

let hasShownResizeErrorWindowsLinux = false;

async function resizeIconsAsync(
  context: AnyStandaloneContext,
  resPath: string,
  prefix: string,
  mdpiSize: number,
  filename: string,
  url: string,
  isDetached: boolean,
) {
  const baseImagePath = path.join(resPath, filename);

  try {
    if (isDetached) {
      const data = context.data as IStandaloneContextDataUser;
      await saveImageToPathAsync(data.projectPath, url, baseImagePath);
    } else {
      await saveUrlToPathAsync(url, baseImagePath);
    }
  } catch (e) {
    throw new Error(`Failed to save icon file to disk. (${e})`);
  }

  await Promise.all(
    Object.entries(iconScales).map(async ([folderSuffix, iconScale]) => {
      // adaptive icons (mdpiSize 108) must be placed in a -v26 folder
      const subdirectoryName = `${prefix}${folderSuffix}${
        mdpiSize === 108 ? '-v26' : ''
      }`;
      const destinationPath = path.join(resPath, subdirectoryName);
      await spawnAsyncThrowError('/bin/cp', [baseImagePath, filename], {
        stdio: 'inherit',
        cwd: destinationPath,
      });

      try {
        await resizeImageAsync(mdpiSize * iconScale, filename, destinationPath);
      } catch (e) {
        // Turtle should be able to resize images, so if it fails we want it to throw.
        // However, `sips` does not exist on Windows or Linux machines, so we expect
        // resizing images to error on these OSes and want the detach process to continue anyway.
        if (isDetached) {
          if (!hasShownResizeErrorWindowsLinux) {
            logger.warn(
              'Failed to resize app icons. ' +
                'Your full size icon will be copied to all android/app/src/main/res directories. ' +
                'For best quality, we recommend providing downscaled versions.',
            );
            hasShownResizeErrorWindowsLinux = true;
          }
        } else {
          throw new Error(`Failed to resize image: ${filename}. ${e}`);
        }
      }

      // reject non-square icons
      const dims = await getImageDimensionsAsync(destinationPath, filename);
      if (!dims) {
        // Again, only throw this error on Turtle -- we expect that this will fail
        // for some detach users but we don't want this to stop the whole process.
        if (!isDetached) {
          throw new Error(`Unable to read the dimensions of ${filename}`);
        }
      } else if (dims.width !== dims.height) {
        throw new Error(
          `Android icons must be square, the dimensions of ${filename} are ${dims}`,
        );
      }
    }),
  );

  await spawnAsyncThrowError('/bin/rm', [baseImagePath]);
}

async function createAndWriteIconsToPathAsync(
  context: AnyStandaloneContext,
  resPath: string,
  isDetached: boolean,
) {
  const manifest = context.config; // manifest or app.json
  let iconUrl =
    manifest.android && manifest.android.iconUrl
      ? manifest.android.iconUrl
      : manifest.iconUrl;
  let notificationIconUrl = manifest.notification
    ? manifest.notification.iconUrl
    : null;

  if (isDetached) {
    // manifest is actually just app.json in this case, so iconUrl fields don't exist
    iconUrl =
      manifest.android && manifest.android.icon
        ? manifest.android.icon
        : manifest.icon;
    notificationIconUrl = manifest.notification
      ? manifest.notification.icon
      : null;
  }

  let iconBackgroundUrl;
  let iconBackgroundColor;
  let iconForegroundUrl;
  if (manifest.android && manifest.android.adaptiveIcon) {
    iconBackgroundColor = manifest.android.adaptiveIcon.backgroundColor;
    if (isDetached) {
      iconForegroundUrl = manifest.android.adaptiveIcon.foregroundImage;
      iconBackgroundUrl = manifest.android.adaptiveIcon.backgroundImage;
    } else {
      iconForegroundUrl = manifest.android.adaptiveIcon.foregroundImageUrl;
      iconBackgroundUrl = manifest.android.adaptiveIcon.backgroundImageUrl;
    }
  }

  if (iconUrl || iconForegroundUrl) {
    // Android 7 and below icon
    if (iconUrl) {
      globSync('**/ic_launcher.png', {
        cwd: resPath,
        absolute: true,
      }).forEach((filePath) => {
        fs.removeSync(filePath);
      });

      await resizeIconsAsync(
        context,
        resPath,
        'mipmap-',
        48,
        'ic_launcher.png',
        iconUrl,
        isDetached,
      );
    }

    // Adaptive icon foreground image
    if (iconForegroundUrl) {
      globSync('**/ic_foreground.png', {
        cwd: resPath,
        absolute: true,
      }).forEach((filePath) => {
        fs.removeSync(filePath);
      });

      await resizeIconsAsync(
        context,
        resPath,
        'mipmap-',
        108,
        'ic_foreground.png',
        iconForegroundUrl,
        isDetached,
      );
    } else {
      // the OS's default method of coercing normal app icons to adaptive
      // makes them look quite different from using an actual adaptive icon (with xml)
      // so we need to support falling back to the old version on Android 8
      globSync('**/mipmap-*-v26/*', {
        cwd: resPath,
        absolute: true,
        dot: true,
      }).forEach((filePath) => {
        fs.removeSync(filePath);
      });

      try {
        globSync('**/mipmap-*-v26', {
          cwd: resPath,
          absolute: true,
        }).forEach((filePath) => {
          fs.rmdirSync(filePath);
        });
      } catch (e) {
        // we don't want the entire detach script to fail if node
        // can't remove the directories for whatever reason.
        // people can remove the directories themselves if they need
        // so just fail silently here
      }
    }
  }

  // Adaptive icon background image or color
  if (iconBackgroundUrl) {
    await resizeIconsAsync(
      context,
      resPath,
      'mipmap-',
      108,
      'ic_background.png',
      iconBackgroundUrl,
      isDetached,
    );

    await regexFileInResSubfoldersAsync(
      '@color/iconBackground',
      '@mipmap/ic_background',
      resPath,
      'mipmap-',
      '-v26',
      'ic_launcher.xml',
    );
  } else if (iconBackgroundColor) {
    await regexFileAsync(
      '"iconBackground">#FFFFFF',
      `"iconBackground">${iconBackgroundColor}`,
      path.join(resPath, 'values', 'colors.xml'),
    );
  }

  // Remove Expo client notification icon resources
  globSync('**/shell_notification_icon.png', {
    cwd: resPath,
    absolute: true,
  }).forEach((filePath) => {
    fs.removeSync(filePath);
  });

  // Add provided notification icon resources, falling back
  // to the app icon if no `notification.icon` is provided
  await resizeIconsAsync(
    context,
    resPath,
    'drawable-',
    24,
    'shell_notification_icon.png',
    notificationIconUrl ?? iconUrl,
    isDetached,
  );
}

export { createAndWriteIconsToPathAsync };
