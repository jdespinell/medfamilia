import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

const getUploadsDir = () => process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
const uploadsDir = getUploadsDir();
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = getUploadsDir();
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.pdf', '.heic'].includes(ext) ? ext : '.bin';
    cb(null, `medfamilia-${Date.now()}-${uuidv4()}${safeExt}`);
  },
});

export const secureUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // Maximum 15 MB per file
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WEBP, HEIC) y documentos PDF.'));
    }
  },
});

export function validateMagicBytes(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.size < 4) return false;

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    if (bytesRead < 4) return false;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return true;
    }

    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return true;
    }

    // PDF: %PDF (25 50 44 46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return true;
    }

    // WebP: RIFF (0..3) and WEBP (8..11)
    if (
      bytesRead >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return true;
    }

    // HEIC / HEIF / ISO media: 'ftyp' (4..7)
    if (bytesRead >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12).toLowerCase();
      const validBrands = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'mp42', 'isom'];
      if (validBrands.includes(brand)) {
        return true;
      }
    }

    return false;
  } catch (err) {
    return false;
  }
}

export function validateUploadedFiles(req: Request, res: Response, next: NextFunction) {
  const filesToValidate: Express.Multer.File[] = [];

  if (req.file) {
    filesToValidate.push(req.file);
  }

  if (req.files) {
    if (Array.isArray(req.files)) {
      filesToValidate.push(...req.files);
    } else {
      for (const field of Object.keys(req.files)) {
        filesToValidate.push(...req.files[field]);
      }
    }
  }

  for (const file of filesToValidate) {
    if (!validateMagicBytes(file.path)) {
      // Unlink all files uploaded during this request
      for (const f of filesToValidate) {
        if (fs.existsSync(f.path)) {
          try {
            fs.unlinkSync(f.path);
          } catch (e) {}
        }
      }
      return res.status(400).json({
        error: 'El contenido del archivo no es válido. Los encabezados no coinciden con los formatos permitidos (JPEG, PNG, WebP, HEIC, PDF).'
      });
    }
  }

  next();
}

