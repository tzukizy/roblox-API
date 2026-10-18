import fs from "node:fs";
import opentype from "opentype.js";
import sharp from "sharp";
import { PATHS } from "../config.js";

let cachedFont = null;

function getFont() {
  if (!cachedFont) {
    if (!fs.existsSync(PATHS.font)) {
      throw new Error(`Font file not found at ${PATHS.font}`);
    }
    const buf = fs.readFileSync(PATHS.font);
    const ab = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    );
    cachedFont = opentype.parse(ab);
  }
  return cachedFont;
}

/**
 * Adds a dilated stroke outline around a transparent PNG buffer.
 *
 * @param {Buffer} logoBuffer
 * @param {Object} [options]
 * @param {number} [options.strokeWidth=2]
 * @param {{ r: number, g: number, b: number }} [options.strokeColor]
 * @returns {Promise<Buffer>}
 */
export async function addOutline(
  logoBuffer,
  {
    strokeWidth = 2,
    strokeColor = { r: 255, g: 255, b: 255 },
  } = {},
) {
  const metadata = await sharp(logoBuffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const padding = strokeWidth;
  const canvasWidth = width + padding * 2;
  const canvasHeight = height + padding * 2;

  // Extract alpha channel and extend with padding
  const alpha = await sharp(logoBuffer)
    .extractChannel(3)
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .raw()
    .toBuffer();

  const dilated = Buffer.alloc(canvasWidth * canvasHeight);

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      let maxAlpha = 0;

      for (let dy = -strokeWidth; dy <= strokeWidth; dy++) {
        for (let dx = -strokeWidth; dx <= strokeWidth; dx++) {
          if (dx * dx + dy * dy > strokeWidth * strokeWidth) {
            continue;
          }

          const sx = x + dx;
          const sy = y + dy;

          if (sx >= 0 && sx < canvasWidth && sy >= 0 && sy < canvasHeight) {
            maxAlpha = Math.max(maxAlpha, alpha[sy * canvasWidth + sx]);
          }
        }
      }

      dilated[y * canvasWidth + x] = maxAlpha;
    }
  }

  const outlinePixels = Buffer.alloc(canvasWidth * canvasHeight * 4);

  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const i = y * canvasWidth + x;
      const originalAlpha = alpha[i];
      const expandedAlpha = dilated[i];

      outlinePixels[i * 4] = strokeColor.r;
      outlinePixels[i * 4 + 1] = strokeColor.g;
      outlinePixels[i * 4 + 2] = strokeColor.b;
      outlinePixels[i * 4 + 3] = Math.round(
        (expandedAlpha * (255 - originalAlpha)) / 255,
      );
    }
  }

  return sharp(outlinePixels, {
    raw: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 4,
    },
  })
    .composite([
      {
        input: logoBuffer,
        left: padding,
        top: padding,
      },
    ])
    .png()
    .toBuffer();
}

const METADATA_TITLE = "KocakZ.me image";
const METADATA_AUTHOR = "KocakZ.me";
const METADATA_DESCRIPTION = "KocakZ.me media image";
const METADATA_COPYRIGHT = "Copyright kocakz.me";

/**
 * Attaches standard KocakZ copyright and description EXIF metadata to a Sharp instance.
 *
 * @param {import("sharp").Sharp} sharpInstance
 * @returns {import("sharp").Sharp}
 */
export function applyKocakzMetadata(sharpInstance) {
  return sharpInstance.withMetadata().withExif({
    IFD0: {
      ImageDescription: METADATA_DESCRIPTION,
      Artist: METADATA_AUTHOR,
      Copyright: METADATA_COPYRIGHT,
      XPTitle: METADATA_TITLE,
      XPAuthor: METADATA_AUTHOR,
      XPComment: METADATA_DESCRIPTION,
    },
  });
}

/**
 * Processes script thumbnails (process: true):
 * 1. Crops top 480x228.
 * 2. Blurs backdrop to 480x270.
 * 3. Applies vector text watermark ("KocakZ.com/script") using DMSans font.
 * 4. Adds outlined KocakZ brand logo.
 * 5. Attaches KocakZ EXIF metadata and encodes to WebP quality 90.
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
export async function processScriptImage(inputBuffer) {
  const width = 480;
  const height = 270;
  const cropHeight = 228;
  const padding = 5;

  // Pre-normalize input image to 480x270 to ensure valid extraction bounds even if upstream image is slightly smaller (e.g. 473x270)
  const normalizedInput = await sharp(inputBuffer)
    .resize(width, height, { fit: "cover" })
    .png()
    .toBuffer();

  // Crop the normalized image.
  const cropped = await sharp(normalizedInput)
    .extract({
      left: 0,
      top: 0,
      width,
      height: cropHeight,
    })
    .png()
    .toBuffer();

  // Create blurred background.
  const background = await sharp(cropped)
    .resize(width, height, { fit: "cover" })
    .blur(20)
    .png()
    .toBuffer();

  // Copyright watermark vector rendering via opentype
  const copyrightText = "KocakZ.com/script";
  const fontSize = 14;
  const font = getFont();
  const scale = (1 / font.unitsPerEm) * fontSize;

  let textWidth = 0;
  for (let i = 0; i < copyrightText.length; i++) {
    const glyph = font.charToGlyph(copyrightText[i]);
    textWidth += (glyph.advanceWidth || 0) * scale;
  }

  const startX = width - padding - textWidth;
  const startY = height - padding;

  let currentX = startX;
  const pathDataParts = [];

  for (let i = 0; i < copyrightText.length; i++) {
    const glyph = font.charToGlyph(copyrightText[i]);
    const glyphPath = glyph.getPath(currentX, startY, fontSize);
    pathDataParts.push(glyphPath.toPathData(2));
    currentX += (glyph.advanceWidth || 0) * scale;
  }

  const combinedPathData = pathDataParts.join(" ");

  const watermarkSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <path d="${combinedPathData}"
            fill="#111a35"
            stroke="white"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"
            paint-order="stroke fill"
            opacity="0.85" />
    </svg>
  `);

  let logoInput = null;
  let logoHeight = 28;

  if (fs.existsSync(PATHS.logo)) {
    const resizedLogo = await sharp(PATHS.logo)
      .resize(26, 26, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .png()
      .toBuffer();

    logoInput = await addOutline(resizedLogo, {
      strokeWidth: 1,
      strokeColor: { r: 255, g: 255, b: 255 },
    });

    const logoMeta = await sharp(logoInput).metadata();
    logoHeight = logoMeta.height ?? 28;
  }

  const composites = [
    {
      input: cropped,
      left: 0,
      top: Math.round((height - cropHeight) / 2),
    },
    {
      input: watermarkSvg,
      left: 0,
      top: 0,
    },
  ];

  if (logoInput) {
    composites.splice(1, 0, {
      input: logoInput,
      left: padding,
      top: Math.round(height - logoHeight + padding / 2),
    });
  }

  return applyKocakzMetadata(
    sharp(background)
      .composite(composites)
      .webp({ quality: 90 }),
  ).toBuffer();
}

/**
 * Processes square game thumbnails and user avatars (process: false):
 * Resizes to 160x160 with cover fit, encodes to WebP quality 90, and attaches KocakZ EXIF metadata.
 *
 * @param {Buffer} inputBuffer
 * @param {number} [size=160]
 * @returns {Promise<Buffer>}
 */
export async function processSquareImage(inputBuffer, size = 160) {
  return applyKocakzMetadata(
    sharp(inputBuffer)
      .resize(size, size, {
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 90 }),
  ).toBuffer();
}
