import path from 'node:path'

/** Where electron-builder put the packed app.asar for an afterPack context. */
export function resolvePackagedAsarPath(context) {
  const appOutDir = context?.appOutDir
  if (!appOutDir || typeof appOutDir !== 'string') {
    throw new Error('electron-builder afterPack context is missing appOutDir')
  }

  if (context.electronPlatformName === 'darwin') {
    if (appOutDir.endsWith('.app')) {
      return path.join(appOutDir, 'Contents', 'Resources', 'app.asar')
    }
    const productName = context.packager?.appInfo?.productFilename || 'Scout'
    return path.join(appOutDir, `${productName}.app`, 'Contents', 'Resources', 'app.asar')
  }

  return path.join(appOutDir, 'resources', 'app.asar')
}
