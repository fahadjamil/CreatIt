function isCompressibleImageType(mime) {
    const t = String(mime || "").toLowerCase();
    if (!t.startsWith("image/"))
        return false;
    // Avoid formats where canvas conversion breaks animation or semantics
    if (t === "image/gif")
        return false;
    if (t === "image/svg+xml")
        return false;
    return true;
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
async function fileToImageBitmap(file) {
    // `createImageBitmap(file)` is widely supported and avoids DOM <img> lifecycle.
    // If it fails, callers should fall back to the original file.
    return await createImageBitmap(file);
}
function computeTargetSize(srcW, srcH, maxW, maxH) {
    const w = Math.max(1, Math.floor(srcW));
    const h = Math.max(1, Math.floor(srcH));
    if (w <= maxW && h <= maxH)
        return { w, h };
    const ratio = Math.min(maxW / w, maxH / h);
    return {
        w: Math.max(1, Math.floor(w * ratio)),
        h: Math.max(1, Math.floor(h * ratio)),
    };
}
function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob)
                reject(new Error("Failed to create compressed blob"));
            else
                resolve(blob);
        }, mimeType, quality);
    });
}
/**
 * Compress an image file (resize + quality) before uploading.
 *
 * - Keeps original filename.
 * - Returns original file if it's not a compressible image type.
 * - Returns original file on any error (never blocks upload).
 */
export async function compressImageFile(file, options = {}) {
    const mime = String(file?.type ?? "");
    if (!file || !isCompressibleImageType(mime))
        return file;
    const maxWidth = clamp(Number(options.maxWidth ?? 1920), 256, 8192);
    const maxHeight = clamp(Number(options.maxHeight ?? 1920), 256, 8192);
    const quality = clamp(Number(options.quality ?? 0.82), 0.5, 0.95);
    const keepPng = options.keepPng ?? true;
    try {
        const bitmap = await fileToImageBitmap(file);
        const { w, h } = computeTargetSize(bitmap.width, bitmap.height, maxWidth, maxHeight);
        // If no resizing is required and file is already small-ish, skip recompress.
        // (Still allow recompressing huge files even if dimensions are within bounds.)
        if (w === bitmap.width && h === bitmap.height && file.size <= 800 * 1024) {
            bitmap.close?.();
            return file;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) {
            bitmap.close?.();
            return file;
        }
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();
        const lower = mime.toLowerCase();
        let outType = lower;
        let outQuality = quality;
        if (lower === "image/png" && keepPng) {
            outType = "image/png";
            outQuality = undefined; // ignored for PNG anyway
        }
        else if (lower === "image/webp") {
            outType = "image/webp";
        }
        else {
            // Default to jpeg for best size reduction (but not if caller wants PNG preserved).
            outType = "image/jpeg";
        }
        const blob = await canvasToBlob(canvas, outType, outQuality);
        const compressed = new File([blob], file.name, {
            type: outType,
            lastModified: file.lastModified,
        });
        // If we somehow made it bigger, keep the original.
        if (compressed.size >= file.size)
            return file;
        return compressed;
    }
    catch {
        return file;
    }
}
