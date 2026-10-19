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
 * Builds standard KocakZ watermark SVG and outlined brand logo composites.
 *
 * @param {Object} [options]
 * @param {number} [options.width=480]
 * @param {number} [options.height=270]
 * @param {string} [options.watermarkText="KocakZ.com/script"]
 * @param {number} [options.padding=5]
 * @returns {Promise<Array<{ input: Buffer, left: number, top: number }>>}
 */
export async function buildWatermarkComposites({
  width = 480,
  height = 270,
  watermarkText = "KocakZ.com/script",
  padding = 5,
} = {}) {
  const fontSize = 14;
  const font = getFont();
  const scale = (1 / font.unitsPerEm) * fontSize;

  let textWidth = 0;
  for (let i = 0; i < watermarkText.length; i++) {
    const glyph = font.charToGlyph(watermarkText[i]);
    textWidth += (glyph.advanceWidth || 0) * scale;
  }

  const startX = width - padding - textWidth;
  const startY = height - padding;

  let currentX = startX;
  const pathDataParts = [];

  for (let i = 0; i < watermarkText.length; i++) {
    const glyph = font.charToGlyph(watermarkText[i]);
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

  const composites = [
    {
      input: watermarkSvg,
      left: 0,
      top: 0,
    },
  ];

  if (fs.existsSync(PATHS.logo)) {
    const resizedLogo = await sharp(PATHS.logo)
      .resize(26, 26, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .ensureAlpha()
      .png()
      .toBuffer();

    const logoInput = await addOutline(resizedLogo, {
      strokeWidth: 1,
      strokeColor: { r: 255, g: 255, b: 255 },
    });

    const logoMeta = await sharp(logoInput).metadata();
    const logoHeight = logoMeta.height ?? 28;

    composites.push({
      input: logoInput,
      left: padding,
      top: Math.round(height - logoHeight + padding / 2),
    });
  }

  return composites;
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

  const watermarkComposites = await buildWatermarkComposites({
    width,
    height,
    watermarkText: "KocakZ.com/script",
  });

  const composites = [
    {
      input: cropped,
      left: 0,
      top: Math.round((height - cropHeight) / 2),
    },
    ...watermarkComposites,
  ];

  return applyKocakzMetadata(
    sharp(background)
      .composite(composites)
      .webp({ quality: 90 }),
  ).toBuffer();
}

/**
 * Processes executor thumbnails (process: "executor"):
 * 1. Centers the logo within a 190x190 bounding box on a 480x270 canvas.
 * 2. Samples top-left pixel for background color matching; if transparent, defaults to dark theme (#0f1219).
 * 3. Applies vector text watermark ("KocakZ.com/script") using DMSans font.
 * 4. Adds outlined KocakZ brand logo.
 * 5. Attaches KocakZ EXIF metadata and encodes to WebP quality 90.
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
export async function processExecutorThumbnail(inputBuffer) {
  const width = 480;
  const height = 270;
  const logoSize = 190;

  // Resize for sampling the background color.
  const { data } = await sharp(inputBuffer)
    .resize(logoSize, logoSize, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Sample the top-left pixel. If transparent (alpha < 50), default to sleek KocakZ dark slate (#0f1219).
  const isTransparent = data[3] < 50;
  const background = isTransparent
    ? { r: 15, g: 18, b: 25, alpha: 1 }
    : { r: data[0], g: data[1], b: data[2], alpha: 1 };

  const logo = await sharp(inputBuffer)
    .resize(logoSize, logoSize, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();

  const watermarkComposites = await buildWatermarkComposites({
    width,
    height,
    watermarkText: "KocakZ.com/script",
  });

  const baseCanvas = sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .composite([
      { input: logo, gravity: "centre" },
      ...watermarkComposites,
    ])
    .flatten({
      background: { r: background.r, g: background.g, b: background.b },
    })
    .webp({ quality: 90 });

  return applyKocakzMetadata(baseCanvas).toBuffer();
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
