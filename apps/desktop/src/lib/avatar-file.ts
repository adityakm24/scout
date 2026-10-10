/** Longest side of a stored agent photo: crisp at the panel's largest size on a 2x screen. */
const AVATAR_PX = 256
/** `profiles.set_asset` refuses anything larger. */
export const AVATAR_MAX_BYTES = 2_000_000

/** A picked image file as a centre-cropped square JPEG data URL, or null when it can't be read. */
export async function avatarDataUrl(file: File): Promise<null | string> {
  let bitmap: ImageBitmap

  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(AVATAR_PX, side)
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return null
  }

  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height
  )
  bitmap.close()

  return canvas.toDataURL('image/jpeg', 0.9)
}
