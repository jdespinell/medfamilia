import { Request, Response, NextFunction } from 'express';
import fs from 'fs';

export interface ValidationIssue {
  field: string;
  message: string;
}

export type ValidatorFn<T = any> = (
  value: any,
  field: string
) => { valid: true; value?: T } | { valid: false; issue: ValidationIssue };

export type Schema = Record<string, ValidatorFn>;

const UUID_OR_ID_REGEX = /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[a-zA-Z0-9_-]{1,100})$/;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export interface StringOptions {
  min?: number;
  max?: number;
  trim?: boolean;
  pattern?: RegExp;
  patternError?: string;
  optional?: boolean;
  default?: string;
  allowEmpty?: boolean;
}

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  optional?: boolean;
  default?: number;
}

export interface BooleanOptions {
  optional?: boolean;
  default?: boolean;
}

export interface PhoneOptions {
  minDigits?: number;
  maxDigits?: number;
  optional?: boolean;
  default?: string;
}

export interface ArrayOptions<T> {
  min?: number;
  max?: number;
  optional?: boolean;
}

export interface ObjectOptions {
  optional?: boolean;
}

export const v = {
  /**
   * String validator with bounded length, optional trimming, and regex matching
   */
  string: (opts: StringOptions = {}): ValidatorFn<string> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null) {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : value };
        }
        return { valid: false, issue: { field, message: `El campo '${field}' es requerido.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser una cadena de texto.` } };
      }

      const str = opts.trim !== false ? value.trim() : value;

      if (!opts.allowEmpty && str.length === 0) {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `El campo '${field}' no puede estar vacío.` } };
      }

      if (opts.min !== undefined && str.length < opts.min) {
        return {
          valid: false,
          issue: {
            field,
            message: `El campo '${field}' debe tener al menos ${opts.min} caracteres (actual: ${str.length}).`,
          },
        };
      }

      if (opts.max !== undefined && str.length > opts.max) {
        return {
          valid: false,
          issue: {
            field,
            message: `El campo '${field}' no puede exceder ${opts.max} caracteres (actual: ${str.length}).`,
          },
        };
      }

      if (opts.pattern && !opts.pattern.test(str)) {
        return {
          valid: false,
          issue: {
            field,
            message: opts.patternError || `El campo '${field}' tiene un formato no válido.`,
          },
        };
      }

      return { valid: true, value: str };
    };
  },

  /**
   * UUID / Entity Identifier validator
   */
  uuid: (opts: { optional?: boolean; default?: string } = {}): ValidatorFn<string> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `El identificador '${field}' es requerido.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `El identificador '${field}' debe ser un texto UUID.` } };
      }

      const clean = value.trim();
      if (!UUID_OR_ID_REGEX.test(clean)) {
        return {
          valid: false,
          issue: { field, message: `El identificador '${field}' debe tener un formato UUID o ID válido.` },
        };
      }

      return { valid: true, value: clean };
    };
  },

  /**
   * Enum validator restricting value to a set of allowed strings
   */
  enum: <T extends string>(allowedValues: readonly T[], opts: { optional?: boolean; default?: T } = {}): ValidatorFn<T> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined as any };
        }
        return { valid: false, issue: { field, message: `El campo '${field}' es requerido.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser un valor válido.` } };
      }

      const clean = value.trim() as T;
      if (!allowedValues.includes(clean)) {
        return {
          valid: false,
          issue: {
            field,
            message: `El valor de '${field}' ('${clean}') no es válido. Opciones permitidas: ${allowedValues.join(', ')}.`,
          },
        };
      }

      return { valid: true, value: clean };
    };
  },

  /**
   * Phone number validator ensuring digit bounds (default 7 to 15 digits)
   */
  phone: (opts: PhoneOptions = {}): ValidatorFn<string> => {
    const minDigits = opts.minDigits ?? 7;
    const maxDigits = opts.maxDigits ?? 15;

    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `El número de teléfono celular es requerido.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser un texto de teléfono válido.` } };
      }

      const digitsOnly = value.replace(/\D/g, '');
      if (digitsOnly.length < minDigits || digitsOnly.length > maxDigits) {
        return {
          valid: false,
          issue: {
            field,
            message: `El número de celular debe contener entre ${minDigits} y ${maxDigits} dígitos válidos.`,
          },
        };
      }

      return { valid: true, value: value.trim() };
    };
  },

  /**
   * ISO-8601 Date / Timestamp validator
   */
  isoDate: (opts: { optional?: boolean; default?: string } = {}): ValidatorFn<string> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `La fecha/hora '${field}' es requerida.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `La fecha/hora '${field}' debe ser una cadena de texto.` } };
      }

      const parsed = Date.parse(value);
      if (isNaN(parsed)) {
        return {
          valid: false,
          issue: { field, message: `El campo '${field}' debe tener un formato de fecha ISO-8601 válido.` },
        };
      }

      return { valid: true, value: new Date(parsed).toISOString() };
    };
  },

  /**
   * Hex Color validator (#RRGGBB)
   */
  hexColor: (opts: { optional?: boolean; default?: string } = {}): ValidatorFn<string> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default ?? '#3b82f6' };
        }
        return { valid: false, issue: { field, message: `El color es requerido.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `El color debe ser un texto en formato hexadecimal (#RRGGBB).` } };
      }

      const clean = value.trim();
      if (!HEX_COLOR_REGEX.test(clean)) {
        return {
          valid: false,
          issue: { field, message: `El color '${clean}' no es válido. Debe usar formato hexadecimal (#RRGGBB).` },
        };
      }

      return { valid: true, value: clean };
    };
  },

  /**
   * Number / Integer validator with optional range bounds
   */
  number: (opts: NumberOptions = {}): ValidatorFn<number> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `El campo numérico '${field}' es requerido.` } };
      }

      const num = typeof value === 'number' ? value : Number(value);
      if (isNaN(num)) {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser un número válido.` } };
      }

      if (opts.integer && !Number.isInteger(num)) {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser un número entero.` } };
      }

      if (opts.min !== undefined && num < opts.min) {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser mayor o igual a ${opts.min}.` } };
      }

      if (opts.max !== undefined && num > opts.max) {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser menor o igual a ${opts.max}.` } };
      }

      return { valid: true, value: num };
    };
  },

  /**
   * Boolean validator supporting booleans and strings ('true', 'false', '1', '0')
   */
  boolean: (opts: BooleanOptions = {}): ValidatorFn<boolean> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `El campo booleano '${field}' es requerido.` } };
      }

      if (typeof value === 'boolean') {
        return { valid: true, value };
      }

      if (value === 'true' || value === '1' || value === 1) {
        return { valid: true, value: true };
      }

      if (value === 'false' || value === '0' || value === 0) {
        return { valid: true, value: false };
      }

      return { valid: false, issue: { field, message: `El campo '${field}' debe ser un valor booleano.` } };
    };
  },

  /**
   * URL validator
   */
  url: (opts: { optional?: boolean; default?: string } = {}): ValidatorFn<string> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null || value === '') {
        if (opts.optional) {
          return { valid: true, value: opts.default !== undefined ? opts.default : undefined };
        }
        return { valid: false, issue: { field, message: `La URL '${field}' es requerida.` } };
      }

      if (typeof value !== 'string') {
        return { valid: false, issue: { field, message: `La URL '${field}' debe ser una cadena de texto.` } };
      }

      try {
        const parsed = new URL(value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return { valid: false, issue: { field, message: `La URL '${field}' debe usar protocolo http o https.` } };
        }
        return { valid: true, value: value.trim() };
      } catch {
        return { valid: false, issue: { field, message: `El campo '${field}' no es una URL válida.` } };
      }
    };
  },

  /**
   * Nested Object Validator
   */
  object: (shape: Schema, opts: ObjectOptions = {}): ValidatorFn<Record<string, any>> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null) {
        if (opts.optional) {
          return { valid: true, value: undefined };
        }
        return { valid: false, issue: { field, message: `El objeto '${field}' es requerido.` } };
      }

      if (typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser un objeto válido.` } };
      }

      const result: Record<string, any> = {};
      for (const [key, validator] of Object.entries(shape)) {
        const fieldName = field ? `${field}.${key}` : key;
        const res = validator(value[key], fieldName);
        if (!res.valid) {
          return res;
        }
        if (res.value !== undefined) {
          result[key] = res.value;
        }
      }

      return { valid: true, value: result };
    };
  },

  /**
   * Array Validator
   */
  array: <T>(itemValidator: ValidatorFn<T>, opts: ArrayOptions<T> = {}): ValidatorFn<T[]> => {
    return (value: any, field: string) => {
      if (value === undefined || value === null) {
        if (opts.optional) {
          return { valid: true, value: undefined };
        }
        return { valid: false, issue: { field, message: `La lista '${field}' es requerida.` } };
      }

      if (!Array.isArray(value)) {
        return { valid: false, issue: { field, message: `El campo '${field}' debe ser un arreglo / lista.` } };
      }

      if (opts.min !== undefined && value.length < opts.min) {
        return {
          valid: false,
          issue: { field, message: `El arreglo '${field}' debe contener al menos ${opts.min} elemento(s).` },
        };
      }

      if (opts.max !== undefined && value.length > opts.max) {
        return {
          valid: false,
          issue: { field, message: `El arreglo '${field}' no puede exceder ${opts.max} elementos.` },
        };
      }

      const sanitizedArray: T[] = [];
      for (let i = 0; i < value.length; i++) {
        const itemRes = itemValidator(value[i], `${field}[${i}]`);
        if (!itemRes.valid) {
          return itemRes;
        }
        if (itemRes.value !== undefined) {
          sanitizedArray.push(itemRes.value as T);
        }
      }

      return { valid: true, value: sanitizedArray };
    };
  },
};

/**
 * Cleanup any files uploaded by multer if validation fails
 */
function cleanupFiles(req: Request) {
  if (req.file && req.file.path && fs.existsSync(req.file.path)) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {}
  }
  if (req.files) {
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        if (f.path && fs.existsSync(f.path)) {
          try {
            fs.unlinkSync(f.path);
          } catch {}
        }
      }
    } else {
      for (const key of Object.keys(req.files)) {
        const filesList = req.files[key];
        for (const f of filesList) {
          if (f.path && fs.existsSync(f.path)) {
            try {
              fs.unlinkSync(f.path);
            } catch {}
          }
        }
      }
    }
  }
}

export interface RequestValidationSchema {
  body?: Schema;
  params?: Schema;
  query?: Schema;
}

/**
 * Universal Request Validation Middleware
 */
export function validateRequest(schemas: RequestValidationSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const issues: ValidationIssue[] = [];

    // 1. Validate Params
    if (schemas.params) {
      const sanitizedParams: Record<string, any> = { ...req.params };
      for (const [key, validator] of Object.entries(schemas.params)) {
        const result = validator(req.params[key], key);
        if (!result.valid) {
          issues.push(result.issue);
        } else if (result.value !== undefined) {
          sanitizedParams[key] = result.value;
        }
      }
      req.params = sanitizedParams;
    }

    // 2. Validate Query
    if (schemas.query) {
      const sanitizedQuery: Record<string, any> = { ...req.query };
      for (const [key, validator] of Object.entries(schemas.query)) {
        const result = validator(req.query[key], key);
        if (!result.valid) {
          issues.push(result.issue);
        } else if (result.value !== undefined) {
          sanitizedQuery[key] = result.value;
        }
      }
      req.query = sanitizedQuery;
    }

    // 3. Validate Body
    if (schemas.body) {
      if (req.body === undefined || req.body === null || (typeof req.body !== 'object' && !Array.isArray(req.body))) {
        issues.push({ field: 'body', message: 'El cuerpo de la solicitud (body) es requerido y debe ser un objeto JSON.' });
      } else {
        const sanitizedBody: Record<string, any> = { ...req.body };
        for (const [key, validator] of Object.entries(schemas.body)) {
          const result = validator(req.body[key], key);
          if (!result.valid) {
            issues.push(result.issue);
          } else if (result.value !== undefined) {
            sanitizedBody[key] = result.value;
          }
        }
        req.body = sanitizedBody;
      }
    }

    if (issues.length > 0) {
      cleanupFiles(req);
      const primaryMessage = issues[0].message;
      return res.status(400).json({
        error: primaryMessage,
        details: issues,
      });
    }

    return next();
  };
}

export const validateBody = (schema: Schema) => validateRequest({ body: schema });
export const validateParams = (schema: Schema) => validateRequest({ params: schema });
export const validateQuery = (schema: Schema) => validateRequest({ query: schema });
