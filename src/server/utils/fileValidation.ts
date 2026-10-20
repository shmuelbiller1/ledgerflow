import { errorMessage } from '../auth/requestUser';
import fs from 'node:fs';
import path from 'node:path';

export type AllowedMimeType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'text/csv' | 'text/plain' | 'application/json';

export interface FileValidationResult {
  valid: boolean;
  detectedMimeType?: string;
  error?: string;
}

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const UPLOAD_ROOT_DIR = process.env.UPLOAD_DIR || './uploads';

async function resolveAndValidateUploadPath(filePath: string): Promise<string> {
  const rootRealPath = await fs.promises.realpath(path.resolve(UPLOAD_ROOT_DIR));
  const resolvedInputPath = path.resolve(filePath);
  const fileRealPath = await fs.promises.realpath(resolvedInputPath);
  const relative = path.relative(rootRealPath, fileRealPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid upload path');
  }
  return fileRealPath;
}

/**
 * Validates the file buffer or file on disk against magic bytes and security rules.
 */
export function validateFileMagicBytes(buffer: Buffer): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Empty file buffer' };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File exceeds maximum allowed size of 25 MB (${(buffer.length / (1024 * 1024)).toFixed(1)} MB)` };
  }

  // Check dangerous executable signatures
  // Windows PE (.exe, .dll) -> "MZ" (0x4D, 0x5A)
  if (buffer.length >= 2 && buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return { valid: false, error: 'Executable files (.exe, .dll) are strictly forbidden' };
  }

  // Linux ELF -> 0x7F, 'E', 'L', 'F' (0x7F, 0x45, 0x4C, 0x46)
  if (buffer.length >= 4 && buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return { valid: false, error: 'Binary executables (ELF) are strictly forbidden' };
  }

  // Mach-O -> 0xFE, 0xED, 0xFA, 0xCE or 0xCE, 0xFA, 0xED, 0xFE or 0xCA, 0xFE, 0xBA, 0xBE
  if (buffer.length >= 4 && (
    (buffer[0] === 0xCA && buffer[1] === 0xFE && buffer[2] === 0xBA && buffer[3] === 0xBE) ||
    (buffer[0] === 0xCF && buffer[1] === 0xFA && buffer[2] === 0xED && buffer[3] === 0xFE)
  )) {
    return { valid: false, error: 'Binary executables (Mach-O) are strictly forbidden' };
  }

  // Anti-virus signature hook (e.g. EICAR standard test string)
  const headerSlice = buffer.subarray(0, 512).toString('ascii', 0, Math.min(512, buffer.length));
  if (headerSlice.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
    return { valid: false, error: 'Security Alert: Anti-virus test signature detected in uploaded file' };
  }

  // 1. PDF -> %PDF (0x25, 0x50, 0x44, 0x46)
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { valid: true, detectedMimeType: 'application/pdf' };
  }

  // 2. PNG -> 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return { valid: true, detectedMimeType: 'image/png' };
  }

  // 3. JPEG -> 0xFF, 0xD8, 0xFF
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, detectedMimeType: 'image/jpeg' };
  }

  // 4. Text / CSV / JSON -> Check for absence of null bytes in the first 4KB
  const sampleLength = Math.min(buffer.length, 4096);
  let hasNullByte = false;
  for (let i = 0; i < sampleLength; i++) {
    if (buffer[i] === 0x00) {
      hasNullByte = true;
      break;
    }
  }

  if (!hasNullByte) {
    const textSample = buffer.subarray(0, sampleLength).toString('utf8').trim();
    if (textSample.startsWith('{') || textSample.startsWith('[')) {
      return { valid: true, detectedMimeType: 'application/json' };
    }
    return { valid: true, detectedMimeType: 'text/csv' };
  }

  return { valid: false, error: 'Unsupported file type or corrupt header magic bytes' };
}

/**
 * Validates a file at the given disk path.
 */
export async function validateUploadedFile(filePath: string): Promise<FileValidationResult> {
  try {
    const safeFilePath = await resolveAndValidateUploadPath(filePath);
    const stat = await fs.promises.stat(safeFilePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: `File exceeds 25 MB limit (${(stat.size / (1024 * 1024)).toFixed(1)} MB)` };
    }

    const fd = await fs.promises.open(safeFilePath, 'r');
    const buffer = Buffer.alloc(Math.min(stat.size, 8192));
    await fd.read(buffer, 0, buffer.length, 0);
    await fd.close();

    return validateFileMagicBytes(buffer);
  } catch (err) {
    return { valid: false, error: `File inspection error: ${errorMessage(err)}` };
  }
}
